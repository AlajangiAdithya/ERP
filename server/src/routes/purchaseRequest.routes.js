const express = require('express');
const { z } = require('zod');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { prSpecsUpload, publicUrlFor } = require('../middleware/upload');
const {
  generateSequentialNumber, normalizeMaterialType,
  paginate, applyDateFilter, isUniqueViolation, validateWorkOrderLink,
  validateRequiredByDate, validateRequiredByDates,
} = require('../utils/helpers');
const { buildCoverageSummary, cancelLeftoverPRItems } = require('../utils/prClosure');
const { validateReason } = require('../utils/reasonValidation');
const {
  EXPORT_ROW_CAP, addInfoSheet, addSheet, createWorkbook, dateCell,
  exportFileName, num, sendWorkbook, titleCase, yesNo,
} = require('../utils/excel');

const router = express.Router();

// Roles that can create/manage their own purchase requests (same privileges as MANAGER).
// PLANNING is included: it raises its own PRs in addition to overseeing the
// whole pipeline (it is deliberately kept OUT of OWN_ONLY_ROLES below so the
// listing endpoint still shows it every PR).
// INWARD_QC raises its own PRs like any other QC-department sub-role; they are
// gated behind QC's approval (see QC_MANAGED_ROLES below).
const REQUESTER_ROLES = ['MANAGER', 'DESIGNS', 'RND', 'QC', 'INWARD_QC', 'STORE_MANAGER', 'LAB', 'METROLOGY', 'NDT', 'SAFETY', 'PLANNING'];
// Subset that should only see PRs they themselves raised. STORE_MANAGER is
// intentionally excluded — they also receive goods against everyone's PRs, so
// they keep full chain visibility like ADMIN.
// SAFETY raises its own PRs; like other requester roles it only sees its own
// (not the whole org's). Add to OWN_ONLY so the listing endpoint scopes correctly.
// PLANNING is intentionally excluded — it raises its own PRs but retains
// org-wide read visibility (a monitor that also files).
const OWN_ONLY_ROLES = ['MANAGER', 'DESIGNS', 'RND', 'QC', 'INWARD_QC', 'LAB', 'METROLOGY', 'NDT', 'SAFETY'];
// Monitor roles — full read visibility across the chain. PLANNING also raises
// its own PRs (see REQUESTER_ROLES), but its visibility stays org-wide.
const MONITOR_ROLES = ['PLANNING'];
// Full chain visibility: Unit Managers, Quality, Designs, R&D, Purchase, Stores, Accounts, Finance, Planning (+ ADMIN).
// LAB / METROLOGY / NDT included so their own raised PRs are visible to them through the listing endpoints.
// ACCOUNTING + FINANCE are admin-level read-only observers — they see the whole
// chain (every PR in every status) but never get the approve/edit endpoints.
const CHAIN_ROLES = ['ADMIN', 'MANAGER', 'QC', 'INWARD_QC', 'DESIGNS', 'RND', 'PURCHASE_OFFICER', 'STORE_MANAGER', 'ACCOUNTING', 'FINANCE', 'PLANNING', 'LAB', 'METROLOGY', 'NDT', 'SAFETY'];
// Roles that are globally-scoped — they raise PRs in their own name, not for any
// specific unit. Their PRs have unitId = null and only show up on their own
// dashboard plus the procurement chain (ADMIN, PURCHASE_OFFICER, ACCOUNTING).
// Includes QC ("Quality") and the QC-department roles (LAB / METROLOGY / NDT)
// because Quality acts as a non-unit function here.
const GLOBAL_REQUESTER_ROLES = ['STORE_MANAGER', 'DESIGNS', 'QC', 'INWARD_QC', 'LAB', 'METROLOGY', 'NDT', 'SAFETY', 'PLANNING'];
// Sub-roles under the QC department. PRs from these roles go to QC for the
// first-level approval before flowing on to ADMIN. INWARD_QC sits here too — it
// may raise its own requests, but nothing leaves the QC department without QC's
// own approval first.
const QC_MANAGED_ROLES = ['LAB', 'METROLOGY', 'NDT', 'INWARD_QC'];

// Everything a PURCHASE_OFFICER may see on the PR list — approved and beyond.
// Doubles as the whitelist for their status tabs, so a tab can only ever narrow
// this set, never widen it.
const PO_VISIBLE_STATUSES = [
  'APPROVED', 'IN_PROGRESS', 'QUOTATION_SUBMITTED', 'QUOTATION_APPROVED',
  'ORDER_PLACED', 'GOODS_ARRIVED', 'QC_PASSED', 'INWARD_DONE', 'CASH_PURCHASE', 'COMPLETED',
];

// Normalises an item's attachment list from the request payload. Accepts the new
// multi-file `attachments` array and falls back to the legacy single
// specAttachmentUrl/Name so older clients keep working. Returns [{url,name,mimeType}].
function itemAttachments(item) {
  if (Array.isArray(item?.attachments) && item.attachments.length) {
    return item.attachments
      .filter((a) => a && a.url)
      .map((a) => ({ url: a.url, name: a.name || 'spec', mimeType: a.mimeType || null }));
  }
  if (item?.specAttachmentUrl) {
    return [{ url: item.specAttachmentUrl, name: item.specAttachmentName || 'spec.pdf', mimeType: null }];
  }
  return [];
}

// Nested-create rows for a PR line's attachments, stamped with the uploader.
const attachmentCreateRows = (item, user) =>
  itemAttachments(item).map((a) => ({
    url: a.url,
    name: a.name,
    mimeType: a.mimeType,
    uploadedById: user?.id || null,
    uploadedByName: user?.name || null,
  }));

// Nested-create rows for the PR's header-level "note" attachments.
const noteAttachmentCreateRows = (data, user) =>
  (Array.isArray(data?.noteAttachments) ? data.noteAttachments : [])
    .filter((a) => a && a.url)
    .map((a) => ({
      url: a.url,
      name: a.name || 'attachment',
      mimeType: a.mimeType || null,
      uploadedById: user?.id || null,
      uploadedByName: user?.name || null,
    }));

// Accumulates each of an item's chosen/uploaded spec files into the product's
// reusable spec library (ProductSpec), de-duped by URL so re-selecting an
// existing spec doesn't create a duplicate. No-op when the item has no product.
async function persistItemSpecToLibrary(client, item, user) {
  if (!item?.productId) return;
  for (const a of itemAttachments(item)) {
    const existing = await client.productSpec.findFirst({
      where: { productId: item.productId, url: a.url },
      select: { id: true },
    });
    if (existing) continue;
    await client.productSpec.create({
      data: {
        productId: item.productId,
        url: a.url,
        name: a.name || 'spec',
        uploadedById: user?.id || null,
        uploadedByName: user?.name || null,
      },
    });
  }
}

// A single uploaded file reference (returned by POST /upload-spec, echoed back on submit).
const attachmentSchema = z.object({
  url: z.string().min(1),
  name: z.string().optional().nullable(),
  mimeType: z.string().optional().nullable(),
});

const createSchema = z.object({
  notes: z.string().optional(),
  // Header-level "note" attachments — files tied to the PR as a whole.
  noteAttachments: z.array(attachmentSchema).optional(),
  // Optional — global-role requesters (STORE_MANAGER, DESIGNS, PLANNING) must
  // specify which unit they are filing the PR for; unit-bound roles ignore this.
  unitId: z.string().uuid().optional().nullable(),
  // Optional header-level link to the Work Order this PR is raised for.
  // null / omitted = "No work order".
  workOrderId: z.string().uuid().optional().nullable(),
  // True when "R & D (product research)" is chosen instead of a Work Order.
  isRnd: z.boolean().optional(),
  items: z.array(z.object({
    productName: z.string().min(1),
    productUnit: z.string().min(1).default('pcs'),
    // The Master Data material this line is for. Optional in the schema only so
    // a missing link produces the readable "add it to Master Data first" message
    // from resolvePrItemProducts() below instead of a raw validation error.
    productId: z.string().uuid().optional().nullable(),
    requestedQty: z.number().positive(),
    // PRF form fields
    materialType: z.string().optional(),
    materialSpecification: z.string().optional(),
    // Per-line spec files uploaded via POST /upload-spec before submit. `attachments`
    // is the current multi-file field; specAttachmentUrl/Name kept for old clients.
    attachments: z.array(attachmentSchema).optional(),
    specAttachmentUrl: z.string().optional().nullable(),
    specAttachmentName: z.string().optional().nullable(),
    qapNo: z.string().optional(),
    drawingNo: z.string().optional(),
    purpose: z.string().optional(),
    sourceOfSupply: z.string().optional(),
    scopeOfWork: z.string().optional(),
    inspectionType: z.string().optional(),
    requiredByDate: z.string().optional(),
    itemRemarks: z.string().optional(),
  })).min(1),
});

// ──── Master data gate on requisition lines ────
// Every line must name a material that is ALREADY in Master Data. The free-text
// "new material" route is gone, and with it the product this route used to
// auto-create at PR time: those rows landed in the catalogue with no ID number,
// no specification and nobody's name on them. The requester now adds the
// material on the Master Data screen first (every requester role may — see
// PRODUCT_CREATE_ROLES in middleware/rbac.js), then picks it here.
//
// Any active catalogue material is pickable, including the ones still flagged
// "needs master data" — those pre-date this rule and are deliberately not
// blocked, so an existing backlog can't stall today's requisitions.
//
// Returns { ok: true, items } with each row's name stamped from the catalogue so
// a PR can never disagree with master data, or { ok: false, error }.
async function resolvePrItemProducts(items) {
  const unlinked = items.find((i) => !i.productId);
  if (unlinked) {
    const label = (unlinked.productName || '').trim();
    return {
      ok: false,
      error: `${label ? `"${label}"` : 'One of the materials'} is not in Master Data. Add it there first, then pick it on the requisition.`,
    };
  }

  const ids = [...new Set(items.map((i) => i.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: ids }, isActive: true },
    select: { id: true, name: true, unit: true, category: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const missing = items.find((i) => !byId.has(i.productId));
  if (missing) {
    const label = (missing.productName || '').trim();
    return {
      ok: false,
      error: `${label ? `"${label}"` : 'A material'} is no longer in Master Data. Pick it again from the catalogue.`,
    };
  }

  return {
    ok: true,
    items: items.map((item) => {
      const product = byId.get(item.productId);
      return {
        ...item,
        // Name and UOM come from master data, not from what was typed, so the
        // requisition, the PO and the stock ledger all say the same thing.
        productName: product.name,
        productUnit: item.productUnit || product.unit || 'pcs',
        materialType: normalizeMaterialType(item.materialType || product.category),
      };
    }),
  };
}

// POST /api/purchase-requests/upload-spec — uploads one or more material-spec /
// note files (any common format) and returns { files: [{url,name,mimeType}] } so
// the create form can attach them to a line (or the PR note) before submitting.
// Accepts a single file under `file` (legacy) or many under `files`. Returns the
// first file's url/name at the top level too so older single-file callers work.
// Only requester roles (and admin) can upload.
router.post(
  '/upload-spec',
  authenticate,
  authorize('ADMIN', 'MANAGER', 'DESIGNS', 'RND', 'STORE_MANAGER', 'QC', 'INWARD_QC', 'LAB', 'METROLOGY', 'NDT', 'SAFETY', 'PLANNING'),
  (req, res) => {
    prSpecsUpload.fields([{ name: 'files', maxCount: 10 }, { name: 'file', maxCount: 1 }])(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
      const uploaded = [...(req.files?.files || []), ...(req.files?.file || [])];
      if (uploaded.length === 0) return res.status(400).json({ error: 'No file uploaded' });
      const files = uploaded.map((f) => ({
        url: publicUrlFor('pr-specs', f.filename),
        name: f.originalname,
        mimeType: f.mimetype || null,
      }));
      res.json({ files, url: files[0].url, name: files[0].name });
    });
  },
);

// GET /api/purchase-requests — list based on role
// Visibility + filter clause for the PR list. Shared by the paged list endpoint
// and the Excel export so an export can never widen what a role is allowed to
// see, and can never disagree with the list the user is looking at.
// `unitId=NONE` picks the PRs that belong to no unit at all — Stores, QC,
// Designs, Planning and the other central departments raise them, and they are
// otherwise impossible to isolate from a unit-wise list.
const NO_UNIT_FILTER = 'NONE';

function buildPrListWhere(user, { status, fromDate, toDate, unitId, search }) {
  const where = {};
  applyDateFilter(where, { fromDate, toDate });

  // Unit-wise filter. Applied on the server so it narrows the whole result set
  // (and therefore the page count and the export) rather than one loaded page.
  if (unitId) {
    where.unitId = unitId === NO_UNIT_FILTER ? null : unitId;
  }

  // Free-text search across everything a PR is looked up by: its number, who
  // raised it, its unit, its work order and the materials on it. Kept in `AND`
  // so it never collides with the role-scoping `OR` set below.
  const q = String(search || '').trim();
  if (q) {
    where.AND = [
      ...(where.AND || []),
      {
        OR: [
          { requestNumber: { contains: q, mode: 'insensitive' } },
          { manager: { name: { contains: q, mode: 'insensitive' } } },
          { unit: { name: { contains: q, mode: 'insensitive' } } },
          { unit: { code: { contains: q, mode: 'insensitive' } } },
          { workOrder: { workOrderNumber: { contains: q, mode: 'insensitive' } } },
          { items: { some: { productName: { contains: q, mode: 'insensitive' } } } },
        ],
      },
    ];
  }

  // Role-based filtering — requester roles see only their own.
  // QC is special: in addition to their own PRs they also oversee PRs raised
  // by LAB / METROLOGY / NDT (the sub-roles of the QC department), since
  // QC is the first-level approver for those PRs.
  if (user.role === 'QC') {
    where.OR = [
      { managerId: user.id },
      { manager: { role: { in: QC_MANAGED_ROLES } } },
    ];
  } else if (OWN_ONLY_ROLES.includes(user.role)) {
    where.managerId = user.id;
  } else if (user.role === 'PURCHASE_OFFICER') {
    // PO sees approved and beyond (including cash purchase PRs they converted)
    where.status = { in: PO_VISIBLE_STATUSES };
  }
  // ADMIN, STORE_MANAGER, ACCOUNTING and FINANCE see all — accounts/finance are
  // full read-only observers, so they get every PR in every status (including
  // the still-floating pending/in-progress ones), exactly like admin.

  // A status tab narrows the list HERE, not in the browser — the client only
  // holds one page, so filtering client-side would hide rows that belong on
  // this page and leave the page count meaningless. For the PO the filter is
  // clamped to the statuses they may already see.
  if (status) {
    if (user.role === 'PURCHASE_OFFICER') {
      if (PO_VISIBLE_STATUSES.includes(status)) where.status = status;
    } else {
      where.status = status;
    }
  }

  return where;
}

router.get('/', authenticate, authorize(...CHAIN_ROLES), async (req, res) => {
  try {
    const { status, page, limit, fromDate, toDate, unitId, search } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = buildPrListWhere(req.user, { status, fromDate, toDate, unitId, search });

    const [requests, total] = await Promise.all([
      prisma.purchaseRequest.findMany({
        where,
        include: {
          manager: { select: { id: true, name: true, username: true, role: true } },
          unit: { select: { id: true, name: true, code: true } },
          workOrder: { select: { id: true, workOrderNumber: true, supplyOrderNo: true } },
          qcApprovedBy: { select: { id: true, name: true } },
          adminApprovedBy: { select: { id: true, name: true } },
          heldBy: { select: { id: true, name: true } },
          noteAttachments: { orderBy: { createdAt: 'asc' } },
          // Required-by change trail (newest first) — the PR detail modal shows
          // who moved each line's date, when, and from what to what.
          dateHistory: { orderBy: { createdAt: 'desc' } },
          items: {
            include: {
              product: { select: { id: true, name: true, sku: true, unit: true, currentStock: true, category: true } },
              attachments: { orderBy: { createdAt: 'asc' } },
              materialPoolMembership: {
                include: {
                  pool: {
                    include: {
                      items: {
                        include: {
                          purchaseRequestItem: {
                            select: {
                              id: true,
                              request: { select: { id: true, requestNumber: true, unit: { select: { id: true, name: true, code: true } } } },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          quotations: {
            // Exclude soft-archived competing quotes so the PR's live quotation
            // list / counters stay clean. The archive remains in DB for the
            // product's supplier-price history.
            where: { supersededAt: null },
            select: {
              id: true, quotationNumber: true, supplierName: true, totalAmount: true, isSelected: true, isUnion: true,
              submittedToAdminAt: true, heldAt: true, holdNote: true,
              createdById: true,
              createdBy: { select: { id: true, name: true } },
              sourceRequests: {
                include: {
                  purchaseRequest: {
                    select: { id: true, requestNumber: true, unit: { select: { id: true, name: true, code: true } } },
                  },
                },
              },
            },
          },
          purchaseOrders: {
            select: {
              id: true, orderNumber: true, customName: true, status: true, totalAmount: true, totalPaid: true, isUnion: true,
              sourceRequests: {
                include: {
                  purchaseRequest: {
                    select: { id: true, requestNumber: true, unit: { select: { id: true, name: true, code: true } } },
                  },
                },
              },
            },
          },
          quotationSources: {
            // Same archive filter on the union-quotation junction so superseded
            // unions don't surface in PR/PO union counters.
            where: { quotation: { supersededAt: null } },
            include: {
              quotation: {
                select: {
                  id: true, quotationNumber: true, supplierName: true, totalAmount: true, isSelected: true, isUnion: true,
                  submittedToAdminAt: true, heldAt: true, holdNote: true,
                  createdById: true,
                  createdBy: { select: { id: true, name: true } },
                  sourceRequests: {
                    include: {
                      purchaseRequest: {
                        select: { id: true, requestNumber: true, unit: { select: { id: true, name: true, code: true } } },
                      },
                    },
                  },
                },
              },
            },
          },
          purchaseOrderSources: {
            include: {
              purchaseOrder: {
                select: {
                  id: true, orderNumber: true, customName: true, status: true, totalAmount: true, totalPaid: true, isUnion: true,
                  sourceRequests: {
                    include: {
                      // createdAt needed on each source PR so the client can compute the
                      // FIFO queue position (oldest PR fills first on partial inwards).
                      purchaseRequest: {
                        select: { id: true, requestNumber: true, createdAt: true, unit: { select: { id: true, name: true, code: true } } },
                      },
                    },
                  },
                  items: {
                    select: {
                      id: true, productName: true, productUnit: true, quantity: true, receivedQty: true, itemStatus: true, purchaseRequestItemId: true,
                      allocations: {
                        select: {
                          id: true, purchaseRequestItemId: true, allocatedQty: true, receivedQty: true,
                          purchaseRequestItem: {
                            select: {
                              id: true,
                              request: { select: { id: true, requestNumber: true, createdAt: true } },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.purchaseRequest.count({ where }),
    ]);

    const requestsWithCoverage = requests.map(r => ({
      ...r,
      coverageSummary: buildCoverageSummary(r.items),
    }));

    res.json({
      requests: requestsWithCoverage,
      total,
      page: Math.ceil(skip / take) + 1,
      totalPages: Math.ceil(total / take),
    });
  } catch (error) {
    console.error('Get purchase requests error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Excel export ───
// Human-readable status labels, kept in step with the client's statusLabel() so
// the spreadsheet reads the same as the screen it was exported from.
const PR_STATUS_LABEL = {
  PENDING_QC: 'Pending QC',
  PENDING_ADMIN: 'Pending Admin',
  ON_HOLD: 'On Hold (clarification)',
  APPROVED: 'Approved',
  IN_PROGRESS: 'In Progress',
  QUOTATION_SUBMITTED: 'Quotation Submitted',
  QUOTATION_APPROVED: 'Quotation Approved',
  ORDER_PLACED: 'Order Placed',
  GOODS_ARRIVED: 'Goods Arrived',
  QC_PASSED: 'QC Passed',
  INWARD_DONE: 'Inward Done',
  COMPLETED: 'Completed',
  REJECTED: 'Rejected',
  CASH_PURCHASE: 'Cash Purchase',
};
const prStatusLabel = (s) => PR_STATUS_LABEL[s] || titleCase(s);

const PR_ITEM_STATUS_LABEL = {
  WAITING: 'Waiting',
  ORDERED: 'Ordered',
  ON_THE_WAY: 'On the Way',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
};

const sum = (list, pick) => list.reduce((t, x) => t + (Number(pick(x)) || 0), 0);
const earliest = (dates) => {
  const valid = dates.filter(Boolean).map((d) => new Date(d)).filter((d) => !Number.isNaN(d.getTime()));
  return valid.length ? new Date(Math.min(...valid.map((d) => d.getTime()))) : null;
};
const joinUnique = (list) => Array.from(new Set(list.filter(Boolean))).join(', ');

// GET /api/purchase-requests/export — the current PR list as a formatted .xlsx.
// Takes the same `status` / `fromDate` / `toDate` / `unitId` / `search` filters as
// the list endpoint and runs through the identical visibility clause, so what
// downloads is exactly what the user can see on screen — just unpaged. Two sheets:
// one row per PR, and one row per material line for anyone pivoting on materials.
// Must stay ABOVE `GET /:id` or that route swallows "export".
router.get('/export', authenticate, authorize(...CHAIN_ROLES), async (req, res) => {
  try {
    const { status, fromDate, toDate, unitId, search } = req.query;
    const where = buildPrListWhere(req.user, { status, fromDate, toDate, unitId, search });

    const [total, requests] = await Promise.all([
      prisma.purchaseRequest.count({ where }),
      prisma.purchaseRequest.findMany({
        where,
        include: {
          manager: { select: { name: true, username: true, role: true } },
          unit: { select: { name: true, code: true } },
          workOrder: { select: { workOrderNumber: true, supplyOrderNo: true } },
          qcApprovedBy: { select: { name: true } },
          adminApprovedBy: { select: { name: true } },
          items: {
            include: {
              product: { select: { sku: true, category: true } },
              attachments: { select: { id: true } },
            },
          },
          quotations: {
            where: { supersededAt: null },
            select: { quotationNumber: true, supplierName: true, totalAmount: true, isSelected: true },
          },
          purchaseOrders: { select: { id: true, orderNumber: true, totalAmount: true, totalPaid: true, status: true } },
          purchaseOrderSources: {
            select: { purchaseOrder: { select: { id: true, orderNumber: true, totalAmount: true, totalPaid: true, status: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: EXPORT_ROW_CAP,
      }),
    ]);

    const prRows = [];
    const itemRows = [];

    for (const r of requests) {
      const items = r.items || [];
      // A PR reaches its PO either directly or through the union pivot — both
      // carry the same order, so merge and de-dupe by id. (Not by order number:
      // Purchase type those in by hand, so two different drafts can both be
      // waiting for one and would collapse into a single row.)
      const orders = [
        ...(r.purchaseOrders || []),
        ...(r.purchaseOrderSources || []).map((s) => s.purchaseOrder).filter(Boolean),
      ].filter((o, i, arr) => arr.findIndex((x) => x.id === o.id) === i);
      const selectedQuote = (r.quotations || []).find((q) => q.isSelected) || null;
      const unitLabel = r.unit?.code ? `${r.unit.code}${r.unit.name ? ` — ${r.unit.name}` : ''}` : 'Central / Non-unit';
      const workOrderLabel = r.isRnd
        ? 'R&D'
        : (r.workOrder?.workOrderNumber
          ? `${r.workOrder.workOrderNumber}${r.workOrder.supplyOrderNo ? ` (SO ${r.workOrder.supplyOrderNo})` : ''}`
          : '');

      prRows.push({
        requestNumber: r.requestNumber,
        status: prStatusLabel(r.status),
        raisedBy: r.manager?.name || '',
        raisedByRole: titleCase(r.manager?.role),
        unit: unitLabel,
        workOrder: workOrderLabel,
        isRnd: yesNo(r.isRnd),
        createdAt: dateCell(r.createdAt),
        lineCount: items.length,
        requestedQty: num(sum(items, (i) => i.requestedQty)),
        approvedQty: num(sum(items, (i) => (i.adminApprovedQty ?? i.requestedQty))),
        purchasedQty: num(sum(items, (i) => i.purchasedQty)),
        requiredBy: dateCell(earliest(items.map((i) => i.requiredByDate))),
        qcApprovedBy: r.qcApprovedBy?.name || '',
        qcApprovedAt: dateCell(r.qcApprovedAt),
        adminApprovedBy: r.adminApprovedBy?.name || '',
        adminApprovedAt: dateCell(r.adminApprovedAt),
        quotationCount: (r.quotations || []).length,
        supplier: selectedQuote?.supplierName || '',
        quotedValue: num(selectedQuote?.totalAmount),
        poNumbers: joinUnique(orders.map((o) => o.orderNumber)),
        poValue: num(sum(orders, (o) => o.totalAmount)),
        poPaid: num(sum(orders, (o) => o.totalPaid)),
        notes: r.notes || '',
        adminNotes: r.adminNotes || '',
      });

      items.forEach((i, idx) => {
        const approved = i.adminApprovedQty ?? i.requestedQty;
        itemRows.push({
          requestNumber: r.requestNumber,
          prStatus: prStatusLabel(r.status),
          unit: unitLabel,
          raisedBy: r.manager?.name || '',
          createdAt: dateCell(r.createdAt),
          sr: idx + 1,
          material: i.productName,
          sku: i.product?.sku || '',
          category: i.materialType || i.product?.category || '',
          uom: i.productUnit || '',
          requestedQty: num(i.requestedQty),
          approvedQty: num(i.adminApprovedQty),
          purchasedQty: num(i.purchasedQty),
          pendingQty: num(Math.max(0, (Number(approved) || 0) - (Number(i.purchasedQty) || 0))),
          itemStatus: i.itemStatus ? (PR_ITEM_STATUS_LABEL[i.itemStatus] || titleCase(i.itemStatus)) : '',
          quotationStatus: titleCase(i.itemQuotationStatus),
          requiredBy: dateCell(i.requiredByDate),
          drawingNo: i.drawingNo || '',
          qapNo: i.qapNo || '',
          specification: i.materialSpecification || '',
          purpose: i.purpose || '',
          sourceOfSupply: i.sourceOfSupply || '',
          scopeOfWork: i.scopeOfWork || '',
          inspectionType: i.inspectionType || '',
          remarks: i.itemRemarks || '',
          specFiles: (i.attachments || []).length,
        });
      });
    }

    const wb = createWorkbook();
    addInfoSheet(wb, {
      title: 'Purchase Requests',
      user: req.user,
      filters: [
        { label: 'Status', value: status ? prStatusLabel(status) : 'All' },
        { label: 'From Date', value: fromDate || 'Beginning' },
        { label: 'To Date', value: toDate || 'Today' },
      ],
      counts: [
        { label: 'Purchase Requests', value: prRows.length },
        { label: 'Material Lines', value: itemRows.length },
        { label: 'Matching Records', value: total },
      ],
      truncated: total > requests.length,
    });

    addSheet(wb, {
      name: 'Purchase Requests',
      rows: prRows,
      columns: [
        { header: 'PR No.', key: 'requestNumber' },
        { header: 'Status', key: 'status' },
        { header: 'Raised By', key: 'raisedBy' },
        { header: 'Department / Role', key: 'raisedByRole' },
        { header: 'Unit', key: 'unit' },
        { header: 'Work Order', key: 'workOrder' },
        { header: 'R&D', key: 'isRnd', align: 'center' },
        { header: 'Raised On', key: 'createdAt', fmt: 'dateTime' },
        { header: 'Lines', key: 'lineCount', fmt: 'int', align: 'right' },
        { header: 'Requested Qty', key: 'requestedQty', fmt: 'qty', align: 'right' },
        { header: 'Approved Qty', key: 'approvedQty', fmt: 'qty', align: 'right' },
        { header: 'Purchased Qty', key: 'purchasedQty', fmt: 'qty', align: 'right' },
        { header: 'Earliest Required By', key: 'requiredBy', fmt: 'date' },
        { header: 'QC Approved By', key: 'qcApprovedBy' },
        { header: 'QC Approved On', key: 'qcApprovedAt', fmt: 'dateTime' },
        { header: 'Admin Approved By', key: 'adminApprovedBy' },
        { header: 'Admin Approved On', key: 'adminApprovedAt', fmt: 'dateTime' },
        { header: 'Quotations', key: 'quotationCount', fmt: 'int', align: 'right' },
        { header: 'Selected Supplier', key: 'supplier' },
        { header: 'Quoted Value', key: 'quotedValue', fmt: 'money', align: 'right' },
        { header: 'PO No.', key: 'poNumbers' },
        { header: 'PO Value', key: 'poValue', fmt: 'money', align: 'right' },
        { header: 'Paid', key: 'poPaid', fmt: 'money', align: 'right' },
        { header: 'Notes', key: 'notes', wrap: true },
        { header: 'Admin Notes', key: 'adminNotes', wrap: true },
      ],
    });

    addSheet(wb, {
      name: 'PR Material Lines',
      rows: itemRows,
      columns: [
        { header: 'PR No.', key: 'requestNumber' },
        { header: 'PR Status', key: 'prStatus' },
        { header: 'Unit', key: 'unit' },
        { header: 'Raised By', key: 'raisedBy' },
        { header: 'Raised On', key: 'createdAt', fmt: 'dateTime' },
        { header: 'Sr.', key: 'sr', fmt: 'int', align: 'right' },
        { header: 'Material Description', key: 'material', wrap: true },
        { header: 'SKU', key: 'sku' },
        { header: 'Material Category', key: 'category' },
        { header: 'UOM', key: 'uom', align: 'center' },
        { header: 'Requested Qty', key: 'requestedQty', fmt: 'qty', align: 'right' },
        { header: 'Approved Qty', key: 'approvedQty', fmt: 'qty', align: 'right' },
        { header: 'Purchased Qty', key: 'purchasedQty', fmt: 'qty', align: 'right' },
        { header: 'Pending Qty', key: 'pendingQty', fmt: 'qty', align: 'right' },
        { header: 'Line Status', key: 'itemStatus' },
        { header: 'Quotation Status', key: 'quotationStatus' },
        { header: 'Required By', key: 'requiredBy', fmt: 'date' },
        { header: 'Drawing No.', key: 'drawingNo' },
        { header: 'QAP No.', key: 'qapNo' },
        { header: 'Specification', key: 'specification', wrap: true },
        { header: 'Purpose', key: 'purpose', wrap: true },
        { header: 'Source of Supply', key: 'sourceOfSupply' },
        { header: 'Scope of Work', key: 'scopeOfWork', wrap: true },
        { header: 'Inspection Type', key: 'inspectionType' },
        { header: 'Remarks', key: 'remarks', wrap: true },
        { header: 'Spec Files', key: 'specFiles', fmt: 'int', align: 'right' },
      ],
    });

    await sendWorkbook(res, wb, exportFileName('Purchase_Requests'));
  } catch (error) {
    console.error('Export purchase requests error:', error);
    // The response may already be streaming XLSX bytes by the time this fires —
    // sending JSON then would corrupt the download, so only answer if untouched.
    if (!res.headersSent) res.status(500).json({ error: 'Failed to generate Excel export' });
    else res.end();
  }
});

// GET /api/purchase-requests/lookup?q= — lean PR-number typeahead.
// Feeds the "issued against PR" picker on MIV clearance, where Stores mentions
// the PR number only. Returns just enough to identify a PR in a dropdown; the
// full list endpoint is far too heavy (every item + attachments) for this.
// Must stay ABOVE `GET /:id` or that route swallows "lookup".
router.get('/lookup', authenticate, authorize(...CHAIN_ROLES), async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const requests = await prisma.purchaseRequest.findMany({
      where: q
        ? {
            OR: [
              { requestNumber: { contains: q, mode: 'insensitive' } },
              { items: { some: { productName: { contains: q, mode: 'insensitive' } } } },
            ],
          }
        : {},
      select: {
        id: true, requestNumber: true, status: true, createdAt: true,
        manager: { select: { id: true, name: true } },
        unit: { select: { id: true, name: true, code: true } },
        workOrder: { select: { id: true, workOrderNumber: true } },
        items: { select: { productName: true }, take: 3 },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
    res.json({ requests });
  } catch (error) {
    console.error('PR lookup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/purchase-requests/in-progress-summary — floating in-progress PR/PO counts visible to ALL roles
router.get('/in-progress-summary', authenticate, async (req, res) => {
  try {
    // PR statuses considered "PR pending" — the PR still needs procurement action
    // before the order is in flight. Once admin has approved a quotation and the
    // PO exists (QUOTATION_APPROVED onwards), the PR's procurement work is done;
    // the PO list owns the rest of the lifecycle.
    const prInProgressStatuses = [
      'PENDING_QC', 'PENDING_ADMIN', 'ON_HOLD', 'APPROVED', 'QUOTATION_SUBMITTED', 'IN_PROGRESS',
    ];
    const poInProgressStatuses = [
      'PENDING_ACCOUNTING', 'CREDIT_PLACED', 'ORDERED', 'PLACED', 'ADVANCE_PAID',
      'PAYMENT_PENDING', 'PAID', 'GOODS_ARRIVED', 'QC_PENDING', 'QC_PASSED', 'QC_FAILED', 'INWARD_DONE',
    ];
    // "Awaiting Inward" — goods have physically arrived at the gate (or are in
    // QC) but have not yet been received into stores (INWARD_DONE). This is the
    // real receiving bottleneck on the in-progress board.
    const poAwaitingInwardStatuses = ['GOODS_ARRIVED', 'QC_PENDING', 'QC_PASSED'];

    // Dashboard "In Progress" modal asks for an org-wide view (scope=all) so a
    // unit manager can see every unit's pending PRs/POs, not just their own.
    // The floating badge omits scope, keeping its per-user role scoping.
    const wantsAllUnits = req.query.scope === 'all';

    // Role-scoped visibility for the In-Progress modal, mirroring the rules on
    // the main PR/PO lists:
    //   - OWN_ONLY_ROLES (MANAGER unit raise, DESIGNS, RND, QC, PLANNING) see
    //     only PRs they themselves raised. (For MANAGER this also means only
    //     their unit's PRs since their PRs are always unit-scoped.)
    //   - Chain roles (ADMIN, PURCHASE_OFFICER, ACCOUNTING, STORE_MANAGER) see
    //     everything in flight.
    // Unit-less PRs (STORES/QC/DESIGNS/PLANNING raised) never carry a unitId,
    // so they will not surface on any unit-bound dashboard view.
    // QC sees their own PRs plus PRs from LAB / METROLOGY / NDT (department oversight).
    const prRoleFilter =
      wantsAllUnits
        ? {}
        : req.user.role === 'QC'
        ? {
            OR: [
              { managerId: req.user.id },
              { manager: { role: { in: QC_MANAGED_ROLES } } },
            ],
          }
        : OWN_ONLY_ROLES.includes(req.user.role)
        ? { managerId: req.user.id }
        : {};
    // POs inherit PR scope via either the direct purchaseRequest link or the
    // sourceRequests pivot (multi-PR purchase orders).
    const poRoleFilter =
      wantsAllUnits
        ? {}
        : req.user.role === 'QC'
        ? {
            OR: [
              { purchaseRequest: { managerId: req.user.id } },
              { purchaseRequest: { manager: { role: { in: QC_MANAGED_ROLES } } } },
              { sourceRequests: { some: { purchaseRequest: { managerId: req.user.id } } } },
              { sourceRequests: { some: { purchaseRequest: { manager: { role: { in: QC_MANAGED_ROLES } } } } } },
            ],
          }
        : OWN_ONLY_ROLES.includes(req.user.role)
        ? {
            OR: [
              { purchaseRequest: { managerId: req.user.id } },
              { sourceRequests: { some: { purchaseRequest: { managerId: req.user.id } } } },
            ],
          }
        : {};

    const [
      prCount, prTotal,
      poCount, poTotal,
      awaitingInwardCount,
      qcFailedCount,
      prSamples, poSamples,
    ] = await Promise.all([
      prisma.purchaseRequest.count({ where: { status: { in: prInProgressStatuses }, ...prRoleFilter } }),
      prisma.purchaseRequest.count({ where: prRoleFilter }),
      prisma.purchaseOrder.count({ where: { status: { in: poInProgressStatuses }, ...poRoleFilter } }),
      prisma.purchaseOrder.count({ where: poRoleFilter }),
      prisma.purchaseOrder.count({ where: { status: { in: poAwaitingInwardStatuses }, ...poRoleFilter } }),
      prisma.purchaseOrder.count({ where: { status: 'QC_FAILED', ...poRoleFilter } }),
      prisma.purchaseRequest.findMany({
        where: { status: { in: prInProgressStatuses }, ...prRoleFilter },
        select: {
          id: true, requestNumber: true, status: true, createdAt: true,
          notes: true,
          manager: { select: { name: true, username: true, role: true } },
          unit: { select: { name: true, code: true } },
          items: { select: { requiredByDate: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 15,
      }),
      prisma.purchaseOrder.findMany({
        where: { status: { in: poInProgressStatuses }, ...poRoleFilter },
        select: {
          id: true, orderNumber: true, customName: true, supplierName: true,
          status: true, totalAmount: true, createdAt: true,
          purchaseRequest: {
            select: {
              requestNumber: true,
              manager: { select: { name: true, username: true } },
              unit: { select: { name: true, code: true } },
            },
          },
          sourceRequests: {
            select: {
              purchaseRequest: {
                select: { requestNumber: true, unit: { select: { name: true, code: true } } },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 15,
      }),
    ]);

    // Compute earliest required-by date per PR (across items) so the UI can show urgency
    const prSamplesEnriched = prSamples.map(pr => {
      const dates = (pr.items || []).map(i => i.requiredByDate).filter(Boolean).map(d => new Date(d));
      const earliest = dates.length ? new Date(Math.min(...dates.map(d => d.getTime()))) : null;
      // Strip items array from the response — only the derived fields are needed by the UI
      const { items, ...rest } = pr; // eslint-disable-line no-unused-vars
      return { ...rest, earliestRequiredBy: earliest };
    });

    res.json({
      prCount, prTotal,
      poCount, poTotal,
      awaitingInwardCount,
      qcFailedCount,
      prSamples: prSamplesEnriched,
      poSamples,
    });
  } catch (error) {
    console.error('In-progress summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/purchase-requests/unit-dashboard — Unit-scoped PR/PO/MIV stats for the current user's unit
router.get('/unit-dashboard', authenticate, async (req, res) => {
  try {
    const unitId = req.user.unitId;
    if (!unitId) {
      return res.json({
        miv: { total: 0, pending: 0, approved: 0, active: 0 },
        pr: { total: 0, pending: 0, active: 0, completed: 0, open: 0, converted: 0 },
        po: { total: 0, active: 0, completed: 0 },
      });
    }

    // A PR is "converted to PO" once at least one purchase order references it —
    // either directly (purchaseOrders) or through a union PO (purchaseOrderSources).
    const prConvertedWhere = {
      unitId,
      OR: [
        { purchaseOrders: { some: {} } },
        { purchaseOrderSources: { some: {} } },
      ],
    };
    // "Open" = still moving through the PR pipeline with no PO created yet.
    const prOpenWhere = {
      unitId,
      status: { in: ['PENDING_QC', 'PENDING_ADMIN', 'ON_HOLD', 'APPROVED', 'QUOTATION_SUBMITTED', 'IN_PROGRESS'] },
      purchaseOrders: { none: {} },
      purchaseOrderSources: { none: {} },
    };

    const poUnitWhere = {
      OR: [
        { purchaseRequest: { unitId } },
        { sourceRequests: { some: { purchaseRequest: { unitId } } } },
      ],
    };

    const [
      mivTotal, mivPending, mivApproved,
      prTotal, prPending, prCompleted, prRejected, prOpen, prConverted,
      poTotal, poCompleted,
    ] = await Promise.all([
      prisma.productRequest.count({ where: { unitId } }),
      prisma.productRequest.count({ where: { unitId, status: 'PENDING' } }),
      prisma.productRequest.count({ where: { unitId, status: 'APPROVED' } }),
      prisma.purchaseRequest.count({ where: { unitId } }),
      prisma.purchaseRequest.count({ where: { unitId, status: 'PENDING_ADMIN' } }),
      prisma.purchaseRequest.count({ where: { unitId, status: 'COMPLETED' } }),
      prisma.purchaseRequest.count({ where: { unitId, status: 'REJECTED' } }),
      prisma.purchaseRequest.count({ where: prOpenWhere }),
      prisma.purchaseRequest.count({ where: prConvertedWhere }),
      prisma.purchaseOrder.count({ where: poUnitWhere }),
      prisma.purchaseOrder.count({ where: { ...poUnitWhere, status: 'COMPLETED' } }),
    ]);

    res.json({
      miv: {
        total: mivTotal,
        pending: mivPending,
        approved: mivApproved,
        active: mivPending + mivApproved,
      },
      pr: {
        total: prTotal,
        pending: prPending,
        active: Math.max(0, prTotal - prCompleted - prRejected),
        completed: prCompleted,
        open: prOpen,
        converted: prConverted,
      },
      po: {
        total: poTotal,
        active: Math.max(0, poTotal - poCompleted),
        completed: poCompleted,
      },
    });
  } catch (error) {
    console.error('Unit dashboard error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/purchase-requests/dashboard-stats — stats for PO dashboard
router.get('/dashboard-stats', authenticate, async (req, res) => {
  try {
    const where = {};
    if (req.user.role === 'QC') {
      where.OR = [
        { managerId: req.user.id },
        { manager: { role: { in: QC_MANAGED_ROLES } } },
      ];
    } else if (OWN_ONLY_ROLES.includes(req.user.role)) {
      where.managerId = req.user.id;
    } else if (req.user.role === 'PURCHASE_OFFICER') {
      where.status = { in: ['APPROVED', 'IN_PROGRESS', 'QUOTATION_SUBMITTED', 'QUOTATION_APPROVED', 'ORDER_PLACED', 'GOODS_ARRIVED', 'QC_PASSED', 'INWARD_DONE'] };
    }
    // ACCOUNTING / FINANCE fall through to the unfiltered count — they observe
    // every PR in every status, same as ADMIN.

    const groups = await prisma.purchaseRequest.groupBy({
      by: ['status'],
      where,
      _count: true,
    });

    const counts = {};
    let total = 0;
    for (const g of groups) {
      counts[g.status] = g._count;
      total += g._count;
    }

    res.json({
      pendingQc: counts['PENDING_QC'] || 0,
      pendingAdmin: counts['PENDING_ADMIN'] || 0,
      onHold: counts['ON_HOLD'] || 0,
      approved: counts['APPROVED'] || 0,
      quotationSubmitted: counts['QUOTATION_SUBMITTED'] || 0,
      quotationApproved: counts['QUOTATION_APPROVED'] || 0,
      orderPlaced: counts['ORDER_PLACED'] || 0,
      goodsArrived: counts['GOODS_ARRIVED'] || 0,
      qcPassed: counts['QC_PASSED'] || 0,
      inwardDone: counts['INWARD_DONE'] || 0,
      inProgress: counts['IN_PROGRESS'] || 0,
      completed: counts['COMPLETED'] || 0,
      rejected: counts['REJECTED'] || 0,
      total,
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/purchase-requests/:id
router.get('/:id', authenticate, authorize(...CHAIN_ROLES), async (req, res) => {
  try {
    const request = await prisma.purchaseRequest.findUnique({
      where: { id: req.params.id },
      include: {
        manager: { select: { id: true, name: true, username: true, role: true, unit: { select: { name: true, code: true } } } },
        unit: { select: { id: true, name: true, code: true } },
        workOrder: { select: { id: true, workOrderNumber: true, supplyOrderNo: true } },
        qcApprovedBy: { select: { id: true, name: true } },
        adminApprovedBy: { select: { id: true, name: true } },
        heldBy: { select: { id: true, name: true } },
        noteAttachments: { orderBy: { createdAt: 'asc' } },
        // Required-by change trail (newest first) — who moved a line's date, when,
        // and from what to what.
        dateHistory: { orderBy: { createdAt: 'desc' } },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true, unit: true, currentStock: true, category: true } },
            attachments: { orderBy: { createdAt: 'asc' } },
            // Pool membership lets the PR detail UI show "Pooled with PR-N · X items"
            // badges and the Unpool button on each item row.
            materialPoolMembership: {
              include: {
                pool: {
                  include: {
                    items: {
                      include: {
                        purchaseRequestItem: {
                          select: {
                            id: true,
                            request: { select: { id: true, requestNumber: true, unit: { select: { id: true, name: true, code: true } } } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        quotations: {
          where: { supersededAt: null },
          select: {
            id: true, quotationNumber: true, supplierName: true, totalAmount: true, isSelected: true, isUnion: true, submittedToAdminAt: true, heldAt: true,
            sourceRequests: {
              include: {
                purchaseRequest: {
                  select: { id: true, requestNumber: true, unit: { select: { id: true, name: true, code: true } } },
                },
              },
            },
          },
        },
        purchaseOrders: {
          select: {
            id: true, orderNumber: true, customName: true, status: true, totalAmount: true, totalPaid: true, isUnion: true,
            sourceRequests: {
              include: {
                purchaseRequest: {
                  select: { id: true, requestNumber: true, unit: { select: { id: true, name: true, code: true } } },
                },
              },
            },
            items: {
              select: {
                id: true, productName: true, productUnit: true, quantity: true, receivedQty: true, itemStatus: true, purchaseRequestItemId: true,
                allocations: {
                  select: {
                    id: true, purchaseRequestItemId: true, allocatedQty: true, receivedQty: true,
                    purchaseRequestItem: {
                      select: {
                        id: true,
                        request: {
                          select: { id: true, requestNumber: true, unit: { select: { id: true, name: true, code: true } } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        quotationSources: {
          where: { quotation: { supersededAt: null } },
          include: {
            quotation: {
              select: {
                id: true, quotationNumber: true, supplierName: true, totalAmount: true, isSelected: true, isUnion: true, submittedToAdminAt: true, heldAt: true,
                sourceRequests: {
                  include: {
                    purchaseRequest: {
                      select: { id: true, requestNumber: true, unit: { select: { id: true, name: true, code: true } } },
                    },
                  },
                },
              },
            },
          },
        },
        purchaseOrderSources: {
          include: {
            purchaseOrder: {
              select: {
                id: true, orderNumber: true, customName: true, status: true, totalAmount: true, totalPaid: true, isUnion: true,
                sourceRequests: {
                  include: {
                    // createdAt needed on each source PR so the client can compute the
                    // FIFO queue position (oldest PR fills first on partial inwards).
                    purchaseRequest: {
                      select: { id: true, requestNumber: true, createdAt: true, unit: { select: { id: true, name: true, code: true } } },
                    },
                  },
                },
                items: {
                  select: {
                    id: true, productName: true, productUnit: true, quantity: true, receivedQty: true, itemStatus: true, purchaseRequestItemId: true,
                    allocations: {
                      select: {
                        id: true, purchaseRequestItemId: true, allocatedQty: true, receivedQty: true,
                        purchaseRequestItem: {
                          select: {
                            id: true,
                            request: { select: { id: true, requestNumber: true, createdAt: true } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!request) return res.status(404).json({ error: 'Purchase request not found' });

    // Requester roles can only view their own — except QC, who can also view
    // PRs from LAB / METROLOGY / NDT under their department oversight.
    if (OWN_ONLY_ROLES.includes(req.user.role) && request.managerId !== req.user.id) {
      const qcOversight =
        req.user.role === 'QC' && QC_MANAGED_ROLES.includes(request.manager?.role);
      if (!qcOversight) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const coverageSummary = buildCoverageSummary(request.items);
    res.json({ ...request, coverageSummary });
  } catch (error) {
    console.error('Get purchase request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/purchase-requests — Requester creates.
router.post('/', authenticate, authorize(...REQUESTER_ROLES), async (req, res) => {
  try {
    const data = createSchema.parse(req.body);

    // Required-by dates must clear the 15-day procurement lead time.
    const rbCheck = validateRequiredByDates(data.items);
    if (!rbCheck.ok) return res.status(400).json({ error: rbCheck.error });

    // Unit-bound roles (MANAGER, RND) file PRs against their own unit. Global
    // roles (STORE_MANAGER, DESIGNS, PLANNING, QC, LAB, METROLOGY, NDT) file
    // PRs in their own name with no unit attached — their PR is owned by them
    // (managerId) and never shows up on any unit dashboard. STORE_MANAGER's
    // PR is effectively "unassigned" (chain-visible); DESIGNS/PLANNING/QC
    // PRs are own-only. LAB/METROLOGY/NDT/INWARD_QC PRs are own-only but also
    // visible to QC for first-level approval.
    let unitId = null;
    if (GLOBAL_REQUESTER_ROLES.includes(req.user.role)) {
      unitId = null;
    } else {
      unitId = req.user.unitId || null;
      if (!unitId) {
        return res.status(400).json({ error: 'Your account is not assigned to a unit. Contact admin.' });
      }
    }

    // Optional Work Order link. Must be a live WO, but any unit's WO is linkable.
    // null = "No work order".
    const woLink = await validateWorkOrderLink(prisma, data.workOrderId, unitId);
    if (!woLink.ok) return res.status(400).json({ error: woLink.error });
    // R&D and a Work Order are mutually exclusive — R&D always clears the WO link.
    const isRnd = !!data.isRnd;
    const workOrderId = isRnd ? null : woLink.workOrderId;

    // Every line must name a material that is already in Master Data.
    const resolved = await resolvePrItemProducts(data.items);
    if (!resolved.ok) return res.status(400).json({ error: resolved.error });
    const itemsResolved = resolved.items;

    // PRs raised by LAB / METROLOGY / NDT / INWARD_QC enter the QC-approval gate
    // first. Every other requester role goes straight to ADMIN as before.
    const needsQcApproval = QC_MANAGED_ROLES.includes(req.user.role);
    const initialStatus = needsQcApproval ? 'PENDING_QC' : 'PENDING_ADMIN';

    // Generate PR number with retry on race.
    let request = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const requestNumber = await generateSequentialNumber(prisma, 'PR');
        request = await prisma.purchaseRequest.create({
          data: {
            requestNumber,
            managerId: req.user.id,
            unitId,
            workOrderId,
            isRnd,
            status: initialStatus,
            notes: data.notes || null,
            noteAttachments: { create: noteAttachmentCreateRows(data, req.user) },
            items: {
              create: itemsResolved.map(item => ({
                productName: item.productName,
                productUnit: item.productUnit || 'pcs',
                productId: item.productId,
                requestedQty: item.requestedQty,
                materialType: item.materialType,
                materialSpecification: item.materialSpecification || null,
                // Legacy single column mirrors the first file; the full multi-file
                // list lives in the attachments relation created alongside it.
                specAttachmentUrl: itemAttachments(item)[0]?.url || null,
                specAttachmentName: itemAttachments(item)[0]?.name || null,
                attachments: { create: attachmentCreateRows(item, req.user) },
                qapNo: item.qapNo || null,
                drawingNo: item.drawingNo || null,
                purpose: item.purpose || null,
                sourceOfSupply: item.sourceOfSupply || null,
                scopeOfWork: item.scopeOfWork || null,
                inspectionType: item.inspectionType || null,
                requiredByDate: item.requiredByDate ? new Date(item.requiredByDate) : null,
                itemRemarks: item.itemRemarks || null,
              })),
            },
          },
          include: {
            manager: { select: { id: true, name: true } },
            unit: { select: { id: true, name: true, code: true } },
            noteAttachments: { orderBy: { createdAt: 'asc' } },
            items: {
              include: {
                product: { select: { id: true, name: true, sku: true, unit: true, category: true } },
                attachments: { orderBy: { createdAt: 'asc' } },
              },
            },
          },
        });
        break;
      } catch (err) {
        if (!isUniqueViolation(err) || attempt === 4) throw err;
      }
    }
    const requestNumber = request.requestNumber;

    // Accumulate each item's spec PDF into its product's reusable spec library
    // so it can be re-selected on future PRs and shows on the product page.
    for (const item of itemsResolved) {
      await persistItemSpecToLibrary(prisma, item, req.user);
    }

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'CREATE',
        entity: 'PurchaseRequest',
        entityId: request.id,
        details: {
          requestNumber,
          unit: request.unit?.code,
          itemCount: data.items.length,
        },
        ipAddress: req.ip,
      },
    });

    // Notify the right approver. LAB/METROLOGY/NDT route to QC first; everyone
    // else continues to go straight to ADMIN.
    const unitLabel = request.unit?.name || request.unit?.code || 'No unit';
    await prisma.notification.create({
      data: {
        type: 'NEW_PURCHASE_REQUEST',
        title: `New Purchase Request: ${requestNumber}`,
        message: needsQcApproval
          ? `${req.user.name} (${req.user.role}) has submitted a purchase request with ${data.items.length} item(s) for QC approval.`
          : `${req.user.name} (${unitLabel}) has submitted a purchase request with ${data.items.length} item(s) for admin approval.`,
        targetRole: needsQcApproval ? 'QC' : 'ADMIN',
        sentById: req.user.id,
      },
    });

    res.status(201).json(request);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('Create purchase request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/purchase-requests/:id — Requester edits their own PR while it is
// still in an editable status (PENDING_QC for QC-gated requesters, or
// PENDING_ADMIN for everyone else). Items are fully replaced; productIds are
// re-resolved just like create so newly added rows still get a Product link.
router.put('/:id', authenticate, authorize(...REQUESTER_ROLES, 'ADMIN'), async (req, res) => {
  try {
    const data = createSchema.parse(req.body);

    const request = await prisma.purchaseRequest.findUnique({
      where: { id: req.params.id },
      include: { unit: { select: { id: true, name: true, code: true } } },
    });
    if (!request) return res.status(404).json({ error: 'Purchase request not found' });

    if (req.user.role !== 'ADMIN' && request.managerId !== req.user.id) {
      return res.status(403).json({ error: 'You can only edit your own requests' });
    }
    // ON_HOLD is editable too — the whole point of an admin hold is that the
    // raiser goes back and fixes what was queried before resending.
    if (!['PENDING_ADMIN', 'PENDING_QC', 'ON_HOLD'].includes(request.status)) {
      return res.status(400).json({ error: 'Only pending requests can be edited' });
    }

    // Required-by dates must clear the 15-day procurement lead time.
    const rbCheck = validateRequiredByDates(data.items);
    if (!rbCheck.ok) return res.status(400).json({ error: rbCheck.error });

    // Re-validate the optional Work Order link (any live WO, any unit).
    const woLink = await validateWorkOrderLink(prisma, data.workOrderId, request.unitId);
    if (!woLink.ok) return res.status(400).json({ error: woLink.error });
    // R&D and a Work Order are mutually exclusive — R&D always clears the WO link.
    const isRnd = !!data.isRnd;

    // Re-resolve each line against Master Data — same rule as create, so a row
    // added during an edit can't slip in as free text either.
    const resolved = await resolvePrItemProducts(data.items);
    if (!resolved.ok) return res.status(400).json({ error: resolved.error });
    const itemsResolved = resolved.items;

    // Swap items in a transaction so a partial failure can't leave the PR with
    // an empty items list. Safe to delete + recreate because PENDING_ADMIN PRs
    // have no quotations, POs or pool memberships referencing their items yet.
    await prisma.$transaction(async (tx) => {
      await tx.purchaseRequestItem.deleteMany({ where: { requestId: request.id } });
      // Header-level note attachments are fully replaced too (like items).
      await tx.purchaseRequestAttachment.deleteMany({ where: { requestId: request.id } });
      await tx.purchaseRequest.update({
        where: { id: request.id },
        data: {
          notes: data.notes || null,
          workOrderId: isRnd ? null : woLink.workOrderId,
          isRnd,
          noteAttachments: { create: noteAttachmentCreateRows(data, req.user) },
          items: {
            create: itemsResolved.map(item => ({
              productName: item.productName,
              productUnit: item.productUnit || 'pcs',
              productId: item.productId,
              requestedQty: item.requestedQty,
              materialType: item.materialType,
              materialSpecification: item.materialSpecification || null,
              // Legacy single column mirrors the first file; full list in the relation.
              specAttachmentUrl: itemAttachments(item)[0]?.url || null,
              specAttachmentName: itemAttachments(item)[0]?.name || null,
              attachments: { create: attachmentCreateRows(item, req.user) },
              qapNo: item.qapNo || null,
              drawingNo: item.drawingNo || null,
              purpose: item.purpose || null,
              sourceOfSupply: item.sourceOfSupply || null,
              scopeOfWork: item.scopeOfWork || null,
              inspectionType: item.inspectionType || null,
              requiredByDate: item.requiredByDate ? new Date(item.requiredByDate) : null,
              itemRemarks: item.itemRemarks || null,
            })),
          },
        },
      });
    });

    // Accumulate edited items' spec PDFs into their product's spec library too.
    for (const item of itemsResolved) {
      await persistItemSpecToLibrary(prisma, item, req.user);
    }

    const updated = await prisma.purchaseRequest.findUnique({
      where: { id: request.id },
      include: {
        manager: { select: { id: true, name: true } },
        unit: { select: { id: true, name: true, code: true } },
        noteAttachments: { orderBy: { createdAt: 'asc' } },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true, unit: true, category: true } },
            attachments: { orderBy: { createdAt: 'asc' } },
          },
        },
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'EDIT',
        entity: 'PurchaseRequest',
        entityId: request.id,
        details: {
          requestNumber: request.requestNumber,
          itemCount: data.items.length,
        },
        ipAddress: req.ip,
      },
    });

    // Quietly tell the current approver (QC for PENDING_QC, ADMIN otherwise)
    // that the PR they may already be reviewing has changed.
    const unitLabel = updated.unit?.name || updated.unit?.code || 'No unit';
    const approverRole = updated.status === 'PENDING_QC' ? 'QC' : 'ADMIN';
    await prisma.notification.create({
      data: {
        type: 'NEW_PURCHASE_REQUEST',
        title: `Purchase Request ${updated.requestNumber} updated`,
        message: `${req.user.name} (${unitLabel}) updated PR ${updated.requestNumber} — please review the latest version.`,
        targetRole: approverRole,
        sentById: req.user.id,
      },
    });

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('Edit purchase request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/purchase-requests/:id/required-by — change the required-by date at ANY
// stage of the PR's life.
//
// Deliberately separate from PUT /:id: that route deletes and recreates the item
// rows, which is only safe while the PR is still pending because quotations, PO
// allocations and material-pool memberships all point at item IDs. This route
// updates the date column in place on the existing rows, so it stays safe once
// the PR is approved, in progress, converted to a PO, or closed.
//
// Nothing downstream stores its own copy of this date — the PR list, PR PDF,
// quotation screen, PO overdue radar and dashboards all read
// PurchaseRequestItem.requiredByDate through the relation — so the new date shows
// up everywhere the moment it is saved here.
//
// Body: { requiredByDate }                    → applies one date to every line
//       { items: [{ id, requiredByDate }] }   → sets them line by line
// A null/empty date clears the field. Any supplied date must still clear the
// 15-day floor.
router.put(
  '/:id/required-by',
  authenticate,
  authorize(...REQUESTER_ROLES, 'ADMIN', 'PURCHASE_OFFICER'),
  async (req, res) => {
    try {
      const request = await prisma.purchaseRequest.findUnique({
        where: { id: req.params.id },
        select: {
          id: true, requestNumber: true, status: true, managerId: true,
          unit: { select: { name: true, code: true } },
          items: { select: { id: true, productName: true, requiredByDate: true } },
        },
      });
      if (!request) return res.status(404).json({ error: 'Purchase request not found' });

      // ADMIN and the purchase officer chasing delivery can retime any PR;
      // a requester only their own.
      const isOverseer = ['ADMIN', 'PURCHASE_OFFICER'].includes(req.user.role);
      if (!isOverseer && request.managerId !== req.user.id) {
        return res.status(403).json({ error: 'You can only change the required-by date on your own requests' });
      }

      // Normalise both body shapes into one list of { id, date } updates.
      const byId = new Map(request.items.map((it) => [it.id, it]));
      let updates;
      if (Array.isArray(req.body?.items)) {
        updates = [];
        for (const row of req.body.items) {
          if (!byId.has(row.id)) {
            return res.status(400).json({ error: 'One of the items does not belong to this purchase request' });
          }
          const check = validateRequiredByDate(
            row.requiredByDate,
            `Required by date for "${byId.get(row.id).productName}"`,
          );
          if (!check.ok) return res.status(400).json({ error: check.error });
          updates.push({ id: row.id, date: check.date });
        }
      } else if ('requiredByDate' in (req.body || {})) {
        const check = validateRequiredByDate(req.body.requiredByDate);
        if (!check.ok) return res.status(400).json({ error: check.error });
        updates = request.items.map((it) => ({ id: it.id, date: check.date }));
      } else {
        return res.status(400).json({ error: 'Provide requiredByDate, or an items array' });
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'Nothing to update' });
      }

      // Only lines whose date actually moved are written and recorded — saving a
      // row without touching its date must not leave a "changed" entry behind.
      const sameDay = (a, b) => {
        if (!a && !b) return true;
        if (!a || !b) return false;
        return new Date(a).getTime() === new Date(b).getTime();
      };
      const realChanges = updates
        .map((u) => ({ ...u, before: byId.get(u.id)?.requiredByDate ?? null }))
        .filter((u) => !sameDay(u.before, u.date));

      if (realChanges.length > 0) {
        await prisma.$transaction([
          ...realChanges.map((u) =>
            prisma.purchaseRequestItem.update({
              where: { id: u.id },
              data: { requiredByDate: u.date },
            }),
          ),
          // The visible trail: who moved this line's date, when, and old → new.
          prisma.purchaseRequestDateHistory.createMany({
            data: realChanges.map((u) => ({
              requestId: request.id,
              itemId: u.id,
              productName: byId.get(u.id)?.productName || null,
              fromDate: u.before,
              toDate: u.date,
              changedById: req.user.id,
              changedByName: req.user.name || null,
              changedByRole: req.user.role || null,
              prStatus: request.status,
            })),
          }),
        ]);
      }

      const updated = await prisma.purchaseRequest.findUnique({
        where: { id: request.id },
        include: {
          manager: { select: { id: true, name: true } },
          unit: { select: { id: true, name: true, code: true } },
          noteAttachments: { orderBy: { createdAt: 'asc' } },
          dateHistory: { orderBy: { createdAt: 'desc' } },
          items: {
            include: {
              product: { select: { id: true, name: true, sku: true, unit: true, category: true } },
              attachments: { orderBy: { createdAt: 'asc' } },
            },
          },
        },
      });

      // A save that changed nothing is a no-op: no audit row, no notification.
      if (realChanges.length === 0) return res.json(updated);

      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'EDIT',
          entity: 'PurchaseRequest',
          entityId: request.id,
          details: {
            requestNumber: request.requestNumber,
            field: 'requiredByDate',
            status: request.status,
            changes: realChanges.map((u) => ({
              itemId: u.id,
              productName: byId.get(u.id)?.productName || null,
              from: u.before,
              to: u.date,
            })),
          },
          ipAddress: req.ip,
        },
      });

      // Tell whoever is working the PR right now that the deadline moved.
      const unitLabel = updated.unit?.name || updated.unit?.code || 'No unit';
      const approverRole =
        updated.status === 'PENDING_QC' ? 'QC'
          : ['PENDING_ADMIN', 'ON_HOLD'].includes(updated.status) ? 'ADMIN'
            : 'PURCHASE_OFFICER';
      // Spell out the actual move in the notification — the reader has to know
      // the new deadline without opening the PR.
      const dayLabel = (d) => (d ? new Date(d).toLocaleDateString('en-GB') : 'not set');
      const moveLines = realChanges
        .slice(0, 3)
        .map((u) => `${byId.get(u.id)?.productName || 'Item'}: ${dayLabel(u.before)} → ${dayLabel(u.date)}`)
        .join('; ');
      const moreCount = realChanges.length - Math.min(realChanges.length, 3);
      await prisma.notification.create({
        data: {
          type: 'NEW_PURCHASE_REQUEST',
          title: `PR ${updated.requestNumber} — required-by date changed`,
          message:
            `${req.user.name} (${unitLabel}) changed the required-by date on PR ${updated.requestNumber} — ` +
            `${moveLines}${moreCount > 0 ? ` and ${moreCount} more line(s)` : ''}.`,
          targetRole: approverRole,
          sentById: req.user.id,
        },
      });

      res.json(updated);
    } catch (error) {
      console.error('Update required-by date error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ──── PR REMARKS — editable at ANY stage ────
// Remarks are the running commentary on a PR: the header-level note plus the
// per-line "Other details / Remarks" column. They keep changing long after the
// PR is raised (spec clarification, revised urgency, a supplier hint), so they
// are editable at every status.
//
// Deliberately separate from PUT /:id, which deletes and recreates the item rows
// — only safe while the PR is still pending, because quotations, PO allocations
// and material-pool memberships all point at item IDs. This route updates the
// remark columns IN PLACE, so it stays safe once the PR is approved, quoted,
// ordered, closed or rejected.
//
// Nothing downstream keeps its own copy of a remark — the PR list/detail, PR
// PDF, quotation screens, record-purchase modal and ION all read
// PurchaseRequest.notes / PurchaseRequestItem.itemRemarks through the relation
// — so an edit surfaces everywhere on the next load.
const MAX_REMARK_LEN = 1000;

// Roles that ACT on what a remark says — Purchase buys against it, Stores
// receives/issues against it. Both are notified on every remark edit; a silent
// change would leave them working from a stale instruction.
const REMARK_WATCHER_ROLES = ['PURCHASE_OFFICER', 'STORE_MANAGER'];

// Trims a remark to text-or-null. Remarks are free-form and often very short
// ("grade SS316"), so they deliberately skip the gibberish `validateReason`
// check that mandatory delay reasons get — only length is enforced.
function parseRemark(raw, label) {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  const text = String(raw).trim();
  if (text.length > MAX_REMARK_LEN) {
    return { ok: false, error: `${label} is too long (max ${MAX_REMARK_LEN} characters).` };
  }
  return { ok: true, value: text || null };
}

const remarkSnippet = (text) => {
  if (!text) return '(cleared)';
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
};

// PUT /api/purchase-requests/:id/remarks
// Body: { notes }                            → header remark
//       { items: [{ id, itemRemarks }] }     → per-line remarks
// Both may be sent together. An empty string or null clears that remark.
router.put('/:id/remarks', authenticate, authorize(...REQUESTER_ROLES, 'ADMIN'), async (req, res) => {
  try {
    const request = await prisma.purchaseRequest.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, requestNumber: true, status: true, managerId: true, notes: true,
        unit: { select: { name: true, code: true } },
        items: { select: { id: true, productName: true, itemRemarks: true } },
      },
    });
    if (!request) return res.status(404).json({ error: 'Purchase request not found' });

    // ADMIN can amend any PR's remarks; a requester only their own.
    if (req.user.role !== 'ADMIN' && request.managerId !== req.user.id) {
      return res.status(403).json({ error: 'You can only edit the remarks on your own requests' });
    }

    const body = req.body || {};
    const hasHeader = Object.prototype.hasOwnProperty.call(body, 'notes');
    const itemRows = Array.isArray(body.items) ? body.items : null;
    if (!hasHeader && !itemRows) {
      return res.status(400).json({ error: 'Provide notes, or an items array' });
    }

    let headerNotes = null;
    if (hasHeader) {
      const parsed = parseRemark(body.notes, 'The PR remark');
      if (!parsed.ok) return res.status(400).json({ error: parsed.error });
      headerNotes = parsed.value;
    }

    // Keyed by item id so a duplicated line in the payload is last-write-wins.
    const byId = new Map(request.items.map((it) => [it.id, it]));
    const itemUpdates = new Map();
    for (const row of itemRows || []) {
      const item = byId.get(row?.id);
      if (!item) {
        return res.status(400).json({ error: 'One of the items does not belong to this purchase request' });
      }
      const parsed = parseRemark(row.itemRemarks, `The remark for "${item.productName}"`);
      if (!parsed.ok) return res.status(400).json({ error: parsed.error });
      itemUpdates.set(item.id, {
        id: item.id,
        productName: item.productName,
        from: item.itemRemarks || null,
        to: parsed.value,
      });
    }

    // Only genuinely-changed remarks are written, audited and notified — resaving
    // the same text must not spam Purchase and Stores.
    const changes = [];
    if (hasHeader && headerNotes !== (request.notes || null)) {
      changes.push({ scope: 'PR', label: 'PR remark', from: request.notes || null, to: headerNotes });
    }
    for (const u of itemUpdates.values()) {
      if (u.to !== u.from) {
        changes.push({ scope: 'ITEM', itemId: u.id, label: u.productName, from: u.from, to: u.to });
      }
    }

    const fullInclude = {
      manager: { select: { id: true, name: true } },
      unit: { select: { id: true, name: true, code: true } },
      noteAttachments: { orderBy: { createdAt: 'asc' } },
      dateHistory: { orderBy: { createdAt: 'desc' } },
      items: {
        include: {
          product: { select: { id: true, name: true, sku: true, unit: true, category: true } },
          attachments: { orderBy: { createdAt: 'asc' } },
        },
      },
    };

    if (changes.length === 0) {
      const unchanged = await prisma.purchaseRequest.findUnique({
        where: { id: request.id },
        include: fullInclude,
      });
      return res.json(unchanged);
    }

    await prisma.$transaction([
      ...(changes.some((c) => c.scope === 'PR')
        ? [prisma.purchaseRequest.update({ where: { id: request.id }, data: { notes: headerNotes } })]
        : []),
      ...changes
        .filter((c) => c.scope === 'ITEM')
        .map((c) => prisma.purchaseRequestItem.update({
          where: { id: c.itemId },
          data: { itemRemarks: c.to },
        })),
    ]);

    const updated = await prisma.purchaseRequest.findUnique({
      where: { id: request.id },
      include: fullInclude,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'EDIT',
        entity: 'PurchaseRequest',
        entityId: request.id,
        details: {
          requestNumber: request.requestNumber,
          field: 'remarks',
          status: request.status,
          changes,
        },
        ipAddress: req.ip,
      },
    });

    // One line per changed remark, capped so the message stays readable on a
    // phone push when someone edits every line of a long PR at once.
    const unitLabel = updated.unit?.name || updated.unit?.code || 'No unit';
    const parts = changes
      .slice(0, 4)
      .map((c) => `${c.scope === 'PR' ? 'PR remark' : c.label}: "${remarkSnippet(c.to)}"`);
    if (changes.length > 4) parts.push(`+${changes.length - 4} more`);
    // Status is spelled out because it tells the reader how urgent the change is
    // (a remark edited at ORDER_PLACED may need the supplier told).
    const statusText = String(request.status).replace(/_/g, ' ').toLowerCase();
    const message =
      `${req.user.name} (${unitLabel}) updated remarks on PR ${request.requestNumber} ` +
      `(${statusText}) — ${parts.join(' · ')}`;

    const targets = REMARK_WATCHER_ROLES.map((role) => ({
      type: 'PR_REMARK_UPDATED',
      title: `PR ${request.requestNumber} — remarks updated`,
      message,
      targetRole: role,
      sentById: req.user.id,
    }));
    // Whoever raised the PR also needs to know when ADMIN amends their remark.
    if (request.managerId && request.managerId !== req.user.id) {
      targets.push({
        type: 'PR_REMARK_UPDATED',
        title: `PR ${request.requestNumber} — remarks updated`,
        message,
        targetUserId: request.managerId,
        sentById: req.user.id,
      });
    }
    await prisma.notification.createMany({ data: targets });

    res.json(updated);
  } catch (error) {
    console.error('Update purchase request remarks error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/purchase-requests/:id/qc-approve — QC department first-level approval
// for PRs raised by LAB / METROLOGY / NDT. On success the PR moves on to ADMIN
// for the second-level approval (status PENDING_QC → PENDING_ADMIN).
router.put('/:id/qc-approve', authenticate, authorize('QC'), async (req, res) => {
  try {
    const { qcNotes, qcDelayRemark } = req.body;

    const request = await prisma.purchaseRequest.findUnique({
      where: { id: req.params.id },
      include: {
        items: true,
        manager: { select: { id: true, name: true, role: true } },
        unit: { select: { name: true } },
      },
    });

    if (!request) return res.status(404).json({ error: 'Purchase request not found' });
    if (request.status !== 'PENDING_QC') {
      return res.status(400).json({ error: 'Only PRs awaiting QC approval can be approved here' });
    }
    if (!QC_MANAGED_ROLES.includes(request.manager?.role)) {
      return res.status(400).json({ error: 'This PR is not under QC oversight' });
    }

    // 48-hour QC SLA — measured from when the PR was raised (createdAt).
    // Past 48h, QC MUST record a genuine delay remark before approving.
    if ((new Date() - new Date(request.createdAt)) > SLA_48H_PR && !qcDelayRemark?.trim()) {
      return res.status(400).json({ error: 'This QC approval is past the 48-hour SLA. Please provide a delay remark explaining why.' });
    }
    if (qcDelayRemark?.trim()) {
      const check = validateReason(qcDelayRemark, { fieldLabel: 'delay remark' });
      if (!check.ok) return res.status(400).json({ error: check.error });
    }

    const updated = await prisma.purchaseRequest.update({
      where: { id: req.params.id },
      data: {
        status: 'PENDING_ADMIN',
        qcNotes: qcNotes || null,
        qcDelayRemark: qcDelayRemark?.trim() || null,
        qcApprovedById: req.user.id,
        qcApprovedAt: new Date(),
      },
      include: {
        manager: { select: { id: true, name: true, role: true } },
        unit: { select: { id: true, name: true, code: true } },
        qcApprovedBy: { select: { id: true, name: true } },
        adminApprovedBy: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true, unit: true } } } },
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'QC_APPROVE',
        entity: 'PurchaseRequest',
        entityId: request.id,
        details: { requestNumber: request.requestNumber, action: 'QC_APPROVED', qcNotes },
        ipAddress: req.ip,
      },
    });

    // Hand the PR off to ADMIN, and let the original requester know QC has signed off.
    await prisma.notification.createMany({
      data: [
        {
          type: 'NEW_PURCHASE_REQUEST',
          title: `New Purchase Request: ${request.requestNumber}`,
          message: `${request.manager.name} (${request.manager.role}) raised PR ${request.requestNumber} — QC has approved, awaiting your review.`,
          targetRole: 'ADMIN',
          sentById: req.user.id,
        },
        {
          type: 'PURCHASE_REQUEST_APPROVED',
          title: `Purchase Request ${request.requestNumber} — QC Approved`,
          message: `Your purchase request ${request.requestNumber} has been approved by QC and forwarded to admin.${qcNotes ? ' QC notes: ' + qcNotes : ''}`,
          targetUserId: request.managerId,
          sentById: req.user.id,
        },
      ],
    });

    res.json(updated);
  } catch (error) {
    console.error('QC approve error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/purchase-requests/:id/qc-reject — QC rejects a LAB/METROLOGY/NDT PR
// before it ever reaches ADMIN.
router.put('/:id/qc-reject', authenticate, authorize('QC'), async (req, res) => {
  try {
    const { qcNotes } = req.body;

    const request = await prisma.purchaseRequest.findUnique({
      where: { id: req.params.id },
      include: { manager: { select: { id: true, name: true, role: true } } },
    });

    if (!request) return res.status(404).json({ error: 'Purchase request not found' });
    if (request.status !== 'PENDING_QC') {
      return res.status(400).json({ error: 'Only PRs awaiting QC approval can be rejected here' });
    }
    if (!QC_MANAGED_ROLES.includes(request.manager?.role)) {
      return res.status(400).json({ error: 'This PR is not under QC oversight' });
    }
    const qcRejectCheck = validateReason(qcNotes, { fieldLabel: 'reason for rejection' });
    if (!qcRejectCheck.ok) return res.status(400).json({ error: qcRejectCheck.error });

    const updated = await prisma.purchaseRequest.update({
      where: { id: req.params.id },
      data: {
        status: 'REJECTED',
        qcNotes: qcNotes || 'Rejected by QC',
        qcApprovedById: req.user.id,
        qcApprovedAt: new Date(),
      },
      include: {
        manager: { select: { id: true, name: true, role: true } },
        unit: { select: { id: true, name: true, code: true } },
        qcApprovedBy: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true, unit: true } } } },
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'QC_REJECT',
        entity: 'PurchaseRequest',
        entityId: request.id,
        details: { requestNumber: request.requestNumber, action: 'QC_REJECTED', reason: qcNotes },
        ipAddress: req.ip,
      },
    });

    await prisma.notification.create({
      data: {
        type: 'PURCHASE_REQUEST_REJECTED',
        title: `Purchase Request ${request.requestNumber} Rejected by QC`,
        message: `Your purchase request ${request.requestNumber} has been rejected by QC. Reason: ${qcNotes || 'No reason provided'}`,
        targetUserId: request.managerId,
        sentById: req.user.id,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('QC reject error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const SLA_48H_PR = 48 * 60 * 60 * 1000;

// PUT /api/purchase-requests/:id/admin-approve — Admin approves (can change qty + add notes)
router.put('/:id/admin-approve', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const { adminNotes, items, adminDelayRemark } = req.body;

    const request = await prisma.purchaseRequest.findUnique({
      where: { id: req.params.id },
      include: { items: true, manager: { select: { name: true } }, unit: { select: { name: true } } },
    });

    if (!request) return res.status(404).json({ error: 'Purchase request not found' });
    if (request.status !== 'PENDING_ADMIN') {
      return res.status(400).json({ error: 'Only pending requests can be approved' });
    }

    // SLA gate: 48h from QC approval (if QC-gated) or PR creation
    const slaStart = request.qcApprovedAt ? new Date(request.qcApprovedAt) : new Date(request.createdAt);
    if ((new Date() - slaStart) > SLA_48H_PR && !adminDelayRemark?.trim()) {
      return res.status(400).json({ error: 'This approval is past the 48-hour SLA. Please provide a delay remark explaining why.' });
    }
    // Delay remark, when provided, must be a genuine reason (not gibberish)
    if (adminDelayRemark?.trim()) {
      const check = validateReason(adminDelayRemark, { fieldLabel: 'delay remark' });
      if (!check.ok) return res.status(400).json({ error: check.error });
    }

    // Update approved quantities
    if (items && Array.isArray(items)) {
      for (const item of items) {
        await prisma.purchaseRequestItem.update({
          where: { id: item.id },
          data: { adminApprovedQty: item.adminApprovedQty },
        });
      }
    } else {
      // Auto-approve full quantities
      for (const item of request.items) {
        await prisma.purchaseRequestItem.update({
          where: { id: item.id },
          data: { adminApprovedQty: item.requestedQty },
        });
      }
    }

    const updated = await prisma.purchaseRequest.update({
      where: { id: req.params.id },
      data: {
        status: 'APPROVED',
        adminNotes: adminNotes || null,
        adminDelayRemark: adminDelayRemark?.trim() || null,
        adminApprovedById: req.user.id,
        adminApprovedAt: new Date(),
      },
      include: {
        manager: { select: { id: true, name: true } },
        unit: { select: { id: true, name: true, code: true } },
        qcApprovedBy: { select: { id: true, name: true } },
        adminApprovedBy: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true, unit: true } } } },
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'ADMIN_APPROVE',
        entity: 'PurchaseRequest',
        entityId: request.id,
        details: { requestNumber: request.requestNumber, action: 'APPROVED', adminNotes },
        ipAddress: req.ip,
      },
    });

    // Notify the creator (look up their role) and purchase officer
    await prisma.notification.createMany({
      data: [
        {
          type: 'PURCHASE_REQUEST_APPROVED',
          title: `Purchase Request ${request.requestNumber} Approved`,
          message: `Your purchase request ${request.requestNumber} has been approved by admin.${adminNotes ? ' Notes: ' + adminNotes : ''}`,
          targetUserId: request.managerId,
          sentById: req.user.id,
        },
        {
          type: 'NEW_PURCHASE_ASSIGNMENT',
          title: `New Purchase Assignment: ${request.requestNumber}`,
          message: `Purchase request ${request.requestNumber} from ${request.manager?.name || 'requester'}${request.unit ? ` (${request.unit.name})` : ''} has been approved. Please proceed with procurement.`,
          targetRole: 'PURCHASE_OFFICER',
          sentById: req.user.id,
        },
      ],
    });

    res.json(updated);
  } catch (error) {
    console.error('Admin approve error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/purchase-requests/:id/admin-reject — Admin rejects
router.put('/:id/admin-reject', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const { adminNotes } = req.body;

    const request = await prisma.purchaseRequest.findUnique({
      where: { id: req.params.id },
      include: { manager: { select: { name: true } } },
    });

    if (!request) return res.status(404).json({ error: 'Purchase request not found' });
    if (request.status !== 'PENDING_ADMIN') {
      return res.status(400).json({ error: 'Only pending requests can be rejected' });
    }
    const rejectCheck = validateReason(adminNotes, { fieldLabel: 'reason for rejection' });
    if (!rejectCheck.ok) return res.status(400).json({ error: rejectCheck.error });

    const updated = await prisma.purchaseRequest.update({
      where: { id: req.params.id },
      data: {
        status: 'REJECTED',
        adminNotes: adminNotes || 'Request rejected',
        adminApprovedById: req.user.id,
        adminApprovedAt: new Date(),
      },
      include: {
        manager: { select: { id: true, name: true } },
        unit: { select: { id: true, name: true, code: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true, unit: true } } } },
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'ADMIN_REJECT',
        entity: 'PurchaseRequest',
        entityId: request.id,
        details: { requestNumber: request.requestNumber, action: 'REJECTED', reason: adminNotes },
        ipAddress: req.ip,
      },
    });

    // Notify the creator (look up their role)
    await prisma.notification.create({
      data: {
        type: 'PURCHASE_REQUEST_REJECTED',
        title: `Purchase Request ${request.requestNumber} Rejected`,
        message: `Your purchase request ${request.requestNumber} has been rejected. Reason: ${adminNotes || 'No reason provided'}`,
        targetUserId: request.managerId,
        sentById: req.user.id,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Admin reject error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ──── ADMIN HOLD — "send back for clarification" ────
// Admin has a doubt but doesn't want to reject: the remark goes to the raiser,
// the PR parks in ON_HOLD, and the raiser answers (and may fix the lines, since
// PUT /:id accepts ON_HOLD) before resending. Each round is appended to
// holdHistory so a PR held twice keeps both exchanges.
// Same shape as the QC-inward hold (materialInward.routes.js /qc-review).

// PUT /api/purchase-requests/:id/admin-hold — Admin holds the PR for clarification
router.put('/:id/admin-hold', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const { holdRemark } = req.body;

    const request = await prisma.purchaseRequest.findUnique({
      where: { id: req.params.id },
      include: { manager: { select: { id: true, name: true } }, unit: { select: { name: true } } },
    });
    if (!request) return res.status(404).json({ error: 'Purchase request not found' });
    if (request.status !== 'PENDING_ADMIN') {
      return res.status(400).json({
        error: request.status === 'ON_HOLD'
          ? 'This request is already on hold, waiting for the raiser to respond.'
          : 'Only requests pending admin approval can be put on hold.',
      });
    }

    const check = validateReason(holdRemark, { fieldLabel: 'clarification you need' });
    if (!check.ok) return res.status(400).json({ error: check.error });

    const remark = check.cleaned || holdRemark.trim();
    const history = Array.isArray(request.holdHistory) ? request.holdHistory : [];
    // One timestamp for both the column and the history entry, so the thread
    // and the heldAt column can never disagree by a few milliseconds.
    const heldAt = new Date();

    const updated = await prisma.purchaseRequest.update({
      where: { id: req.params.id },
      data: {
        status: 'ON_HOLD',
        holdRemark: remark,
        heldAt,
        heldById: req.user.id,
        holdCount: { increment: 1 },
        // The open round is appended now (without a response) so the thread reads
        // in order even while the raiser hasn't answered yet.
        holdHistory: [
          ...history,
          {
            round: (request.holdCount || 0) + 1,
            remark,
            heldById: req.user.id,
            heldByName: req.user.name || null,
            heldAt: heldAt.toISOString(),
            response: null,
            respondedById: null,
            respondedByName: null,
            respondedAt: null,
          },
        ],
      },
      include: {
        manager: { select: { id: true, name: true } },
        unit: { select: { id: true, name: true, code: true } },
        qcApprovedBy: { select: { id: true, name: true } },
        adminApprovedBy: { select: { id: true, name: true } },
        heldBy: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true, unit: true } } } },
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'ADMIN_HOLD',
        entity: 'PurchaseRequest',
        entityId: request.id,
        details: { requestNumber: request.requestNumber, action: 'ON_HOLD', holdRemark: remark, round: (request.holdCount || 0) + 1 },
        ipAddress: req.ip,
      },
    });

    if (request.managerId) {
      await prisma.notification.create({
        data: {
          type: 'PURCHASE_REQUEST_HELD',
          title: `Clarification needed on ${request.requestNumber}`,
          message: `${req.user.name} has put your purchase request ${request.requestNumber} on hold and needs a clarification: "${remark}" — answer it (edit the request if needed) and resend for approval.`,
          targetUserId: request.managerId,
          sentById: req.user.id,
        },
      });
    }

    res.json(updated);
  } catch (error) {
    console.error('Admin hold error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/purchase-requests/:id/hold-response — raiser answers and resends to Admin
router.put(
  '/:id/hold-response',
  authenticate,
  authorize(...REQUESTER_ROLES, 'ADMIN'),
  async (req, res) => {
    try {
      const { response } = req.body;

      const request = await prisma.purchaseRequest.findUnique({
        where: { id: req.params.id },
        include: {
          manager: { select: { id: true, name: true } },
          unit: { select: { name: true } },
          heldBy: { select: { id: true, name: true } },
        },
      });
      if (!request) return res.status(404).json({ error: 'Purchase request not found' });
      if (request.status !== 'ON_HOLD') {
        return res.status(400).json({ error: 'This request is not on hold.' });
      }
      // The raiser answers their own PR; ADMIN can answer on their behalf (e.g.
      // the clarification came through over the phone).
      if (req.user.role !== 'ADMIN' && request.managerId !== req.user.id) {
        return res.status(403).json({ error: 'You can only respond to a hold on your own requests' });
      }

      const check = validateReason(response, { fieldLabel: 'clarification' });
      if (!check.ok) return res.status(400).json({ error: check.error });

      const answer = check.cleaned || response.trim();
      const history = Array.isArray(request.holdHistory) ? [...request.holdHistory] : [];
      const openRound = history.length ? history[history.length - 1] : null;
      const respondedAt = new Date().toISOString();

      if (openRound && !openRound.response) {
        history[history.length - 1] = {
          ...openRound,
          response: answer,
          respondedById: req.user.id,
          respondedByName: req.user.name || null,
          respondedAt,
        };
      } else {
        // Defensive: a hold with no open round (data written before this feature
        // or an admin answering twice) still records the response rather than
        // dropping it.
        history.push({
          round: request.holdCount || history.length + 1,
          remark: request.holdRemark || null,
          heldById: request.heldById,
          heldByName: request.heldBy?.name || null,
          heldAt: request.heldAt ? request.heldAt.toISOString() : null,
          response: answer,
          respondedById: req.user.id,
          respondedByName: req.user.name || null,
          respondedAt,
        });
      }

      const updated = await prisma.purchaseRequest.update({
        where: { id: req.params.id },
        data: {
          // Straight back into the admin queue. heldAt/heldById are kept as the
          // record of the last hold; holdRemark is cleared because the open
          // question has now been answered (the thread lives in holdHistory).
          status: 'PENDING_ADMIN',
          holdRemark: null,
          holdHistory: history,
        },
        include: {
          manager: { select: { id: true, name: true } },
          unit: { select: { id: true, name: true, code: true } },
          qcApprovedBy: { select: { id: true, name: true } },
          adminApprovedBy: { select: { id: true, name: true } },
          heldBy: { select: { id: true, name: true } },
          items: { include: { product: { select: { id: true, name: true, sku: true, unit: true } } } },
        },
      });

      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'HOLD_RESPONSE',
          entity: 'PurchaseRequest',
          entityId: request.id,
          details: { requestNumber: request.requestNumber, action: 'PENDING_ADMIN', response: answer, round: request.holdCount },
          ipAddress: req.ip,
        },
      });

      // Back to whoever held it; ADMIN as a group if that user is gone.
      await prisma.notification.create({
        data: {
          type: 'PURCHASE_REQUEST_HOLD_ANSWERED',
          title: `Clarification received on ${request.requestNumber}`,
          message: `${req.user.name} answered the hold on purchase request ${request.requestNumber}${request.unit ? ` (${request.unit.name})` : ''}: "${answer}" — it is back in your approval queue.`,
          ...(request.heldById ? { targetUserId: request.heldById } : { targetRole: 'ADMIN' }),
          sentById: req.user.id,
        },
      });

      res.json(updated);
    } catch (error) {
      console.error('Hold response error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// PUT /api/purchase-requests/:id/admin-update-notes — Admin updates notes on any request
router.put('/:id/admin-update-notes', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const { adminNotes } = req.body;

    const updated = await prisma.purchaseRequest.update({
      where: { id: req.params.id },
      data: { adminNotes },
      include: {
        manager: { select: { id: true, name: true } },
        unit: { select: { id: true, name: true, code: true } },
        qcApprovedBy: { select: { id: true, name: true } },
        adminApprovedBy: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true, unit: true } } } },
      },
    });

    res.json(updated);
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Purchase request not found' });
    console.error('Update notes error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/purchase-requests/:id/record-purchase — PO records partial/full purchase
router.put('/:id/record-purchase', authenticate, authorize('PURCHASE_OFFICER'), async (req, res) => {
  try {
    const { items } = req.body; // [{ id, purchasedQty }]

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items with purchased quantities are required' });
    }

    const request = await prisma.purchaseRequest.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });

    if (!request) return res.status(404).json({ error: 'Purchase request not found' });
    if (!['APPROVED', 'IN_PROGRESS'].includes(request.status)) {
      return res.status(400).json({ error: 'Can only record purchases for approved or in-progress requests' });
    }

    // Update purchased quantities
    for (const item of items) {
      const reqItem = request.items.find(i => i.id === item.id);
      if (!reqItem) continue;

      const newPurchasedQty = item.purchasedQty;
      const approvedQty = reqItem.adminApprovedQty || reqItem.requestedQty;

      if (newPurchasedQty > approvedQty) {
        return res.status(400).json({ error: `Purchased qty cannot exceed approved qty for item ${item.id}` });
      }

      await prisma.purchaseRequestItem.update({
        where: { id: item.id },
        data: { purchasedQty: newPurchasedQty },
      });
    }

    // Check if all items are fully purchased
    const updatedItems = await prisma.purchaseRequestItem.findMany({
      where: { requestId: req.params.id },
    });

    const allComplete = updatedItems.every(i => i.purchasedQty >= (i.adminApprovedQty || i.requestedQty));

    const newStatus = allComplete ? 'COMPLETED' : 'IN_PROGRESS';

    const updated = await prisma.purchaseRequest.update({
      where: { id: req.params.id },
      data: { status: newStatus },
      include: {
        manager: { select: { id: true, name: true } },
        unit: { select: { id: true, name: true, code: true } },
        qcApprovedBy: { select: { id: true, name: true } },
        adminApprovedBy: { select: { id: true, name: true } },
        items: {
          include: { product: { select: { id: true, name: true, sku: true, unit: true } } },
        },
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'RECORD_PURCHASE',
        entity: 'PurchaseRequest',
        entityId: request.id,
        details: {
          requestNumber: request.requestNumber,
          newStatus,
          items: items.map(i => ({ id: i.id, purchasedQty: i.purchasedQty })),
        },
        ipAddress: req.ip,
      },
    });

    // Notify the creator if completed
    if (allComplete) {
      await prisma.notification.create({
        data: {
          type: 'PURCHASE_COMPLETED',
          title: `Purchase Complete: ${request.requestNumber}`,
          message: `All items for purchase request ${request.requestNumber} have been fully purchased.`,
          targetUserId: request.managerId,
          sentById: req.user.id,
        },
      });
    }

    res.json(updated);
  } catch (error) {
    console.error('Record purchase error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/purchase-requests/:id/cancel — Requester cancels own pending request
router.put('/:id/cancel', authenticate, authorize(...REQUESTER_ROLES), async (req, res) => {
  try {
    const request = await prisma.purchaseRequest.findUnique({
      where: { id: req.params.id },
    });

    if (!request) return res.status(404).json({ error: 'Purchase request not found' });
    if (request.managerId !== req.user.id) {
      return res.status(403).json({ error: 'You can only cancel your own requests' });
    }
    if (!['PENDING_ADMIN', 'PENDING_QC', 'ON_HOLD'].includes(request.status)) {
      return res.status(400).json({ error: 'Only pending requests can be cancelled' });
    }

    const updated = await prisma.purchaseRequest.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED' },
      include: {
        manager: { select: { id: true, name: true } },
        unit: { select: { id: true, name: true, code: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true, unit: true } } } },
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'CANCEL',
        entity: 'PurchaseRequest',
        entityId: request.id,
        details: { requestNumber: request.requestNumber, action: 'CANCELLED' },
        ipAddress: req.ip,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Cancel purchase request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/purchase-requests/:id/close — Unit Manager manually closes their
// own PR. Allowed in any non-terminal state. Any still-live items are flipped
// to CANCELLED (which also prunes their pending quotations) and the PR is
// forced to COMPLETED so downstream queues stop tracking it.
router.post('/:id/close', authenticate, authorize('ADMIN', ...REQUESTER_ROLES), async (req, res) => {
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';

    const request = await prisma.purchaseRequest.findUnique({
      where: { id: req.params.id },
      include: { items: { select: { id: true, itemQuotationStatus: true } } },
    });
    if (!request) return res.status(404).json({ error: 'Purchase request not found' });

    if (req.user.role !== 'ADMIN' && request.managerId !== req.user.id) {
      return res.status(403).json({ error: 'You can only close your own requests' });
    }

    if (['COMPLETED', 'REJECTED'].includes(request.status)) {
      return res.status(400).json({ error: 'Purchase request is already closed' });
    }

    const priorStatus = request.status;
    const liveItemIds = request.items
      .filter(i => i.itemQuotationStatus !== 'CANCELLED')
      .map(i => i.id);

    await prisma.$transaction(async (tx) => {
      if (liveItemIds.length > 0) {
        await cancelLeftoverPRItems(tx, liveItemIds, reason || 'Closed by unit manager');
      }
      // cancelLeftoverPRItems' status sync skips terminal states, so force the
      // final COMPLETED here to guarantee a manual close is sticky regardless
      // of where the PR was sitting (e.g. ORDER_PLACED).
      await tx.purchaseRequest.update({
        where: { id: request.id },
        data: { status: 'COMPLETED' },
      });
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'CLOSE_PR',
        entity: 'PurchaseRequest',
        entityId: request.id,
        details: { requestNumber: request.requestNumber, reason: reason || null, priorStatus },
        ipAddress: req.ip,
      },
    });

    await prisma.notification.create({
      data: {
        type: 'PR_CLOSED',
        title: `PR ${request.requestNumber} closed`,
        message: `${req.user.name} closed PR ${request.requestNumber}${reason ? '. Reason: ' + reason : ''}`,
        targetRole: 'ADMIN',
        sentById: req.user.id,
      },
    });

    const updated = await prisma.purchaseRequest.findUnique({
      where: { id: request.id },
      include: {
        manager: { select: { id: true, name: true } },
        unit: { select: { id: true, name: true, code: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true, unit: true } } } },
      },
    });
    res.json(updated);
  } catch (error) {
    console.error('Close purchase request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/purchase-requests/:id/convert-to-cash-purchase
// Purchase Officer converts an APPROVED PR to a cash purchase, bypassing the
// normal quotation / PO / QC chain. The PR status flips to CASH_PURCHASE so
// Stores can receive against it via the InwardEntry cash-purchase flow.
router.put('/:id/convert-to-cash-purchase', authenticate, authorize('PURCHASE_OFFICER', 'ADMIN'), async (req, res) => {
  try {
    const request = await prisma.purchaseRequest.findUnique({
      where: { id: req.params.id },
      include: {
        items: { select: { id: true, itemQuotationStatus: true } },
        manager: { select: { name: true } },
        unit: { select: { name: true } },
      },
    });

    if (!request) return res.status(404).json({ error: 'Purchase request not found' });
    if (request.status !== 'APPROVED') {
      return res.status(400).json({ error: 'Only APPROVED purchase requests can be converted to cash purchase' });
    }

    const liveItemIds = request.items
      .filter((i) => i.itemQuotationStatus !== 'CANCELLED')
      .map((i) => i.id);

    await prisma.$transaction(async (tx) => {
      if (liveItemIds.length > 0) {
        await cancelLeftoverPRItems(tx, liveItemIds, 'Converted to cash purchase');
      }
      await tx.purchaseRequest.update({
        where: { id: request.id },
        data: { status: 'CASH_PURCHASE' },
      });
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'CONVERT_TO_CASH_PURCHASE',
        entity: 'PurchaseRequest',
        entityId: request.id,
        details: { requestNumber: request.requestNumber },
        ipAddress: req.ip,
      },
    });

    await prisma.notification.createMany({
      data: [
        {
          type: 'PURCHASE_REQUEST_APPROVED',
          title: `PR ${request.requestNumber} converted to Cash Purchase`,
          message: `Purchase request ${request.requestNumber} has been converted to a cash purchase by ${req.user.name}. Stores will receive the material directly.`,
          targetUserId: request.managerId,
          sentById: req.user.id,
        },
        {
          type: 'PURCHASE_REQUEST_APPROVED',
          title: `PR ${request.requestNumber} — Cash Purchase`,
          message: `PR ${request.requestNumber} from ${request.manager?.name || 'requester'}${request.unit ? ` (${request.unit.name})` : ''} has been converted to a cash purchase. Awaiting store receipt.`,
          targetRole: 'STORE_MANAGER',
          sentById: req.user.id,
        },
      ],
    });

    const updated = await prisma.purchaseRequest.findUnique({
      where: { id: request.id },
      include: {
        manager: { select: { id: true, name: true } },
        unit: { select: { id: true, name: true, code: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true, unit: true } } } },
      },
    });
    res.json(updated);
  } catch (error) {
    console.error('Convert to cash purchase error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
