const express = require('express');
const { z } = require('zod');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { prSpecsUpload, publicUrlFor } = require('../middleware/upload');
const {
  generateSequentialNumber, generateProductSku, normalizeMaterialType,
  paginate, applyDateFilter, isUniqueViolation,
} = require('../utils/helpers');
const { buildCoverageSummary, cancelLeftoverPRItems } = require('../utils/prClosure');

const router = express.Router();

// Roles that can create/manage their own purchase requests (same privileges as MANAGER).
const REQUESTER_ROLES = ['MANAGER', 'DESIGNS', 'RND', 'QC', 'STORE_MANAGER', 'LAB', 'METROLOGY', 'NDT', 'SAFETY'];
// Subset that should only see PRs they themselves raised. STORE_MANAGER is
// intentionally excluded — they also receive goods against everyone's PRs, so
// they keep full chain visibility like ADMIN.
// SAFETY raises its own PRs; like other requester roles it only sees its own
// (not the whole org's). Add to OWN_ONLY so the listing endpoint scopes correctly.
const OWN_ONLY_ROLES = ['MANAGER', 'DESIGNS', 'RND', 'QC', 'LAB', 'METROLOGY', 'NDT', 'SAFETY'];
// Monitor-only roles — full read visibility across the chain, no raise/approve.
// PLANNING oversees the whole PR pipeline but never files its own PRs.
const MONITOR_ROLES = ['PLANNING'];
// Full chain visibility: Unit Managers, Quality, Designs, R&D, Purchase, Stores, Accounts, Planning (+ ADMIN).
// LAB / METROLOGY / NDT included so their own raised PRs are visible to them through the listing endpoints.
const CHAIN_ROLES = ['ADMIN', 'MANAGER', 'QC', 'DESIGNS', 'RND', 'PURCHASE_OFFICER', 'STORE_MANAGER', 'ACCOUNTING', 'PLANNING', 'LAB', 'METROLOGY', 'NDT', 'SAFETY'];
// Roles that are globally-scoped — they raise PRs in their own name, not for any
// specific unit. Their PRs have unitId = null and only show up on their own
// dashboard plus the procurement chain (ADMIN, PURCHASE_OFFICER, ACCOUNTING).
// Includes QC ("Quality") and the QC-department roles (LAB / METROLOGY / NDT)
// because Quality acts as a non-unit function here.
const GLOBAL_REQUESTER_ROLES = ['STORE_MANAGER', 'DESIGNS', 'QC', 'LAB', 'METROLOGY', 'NDT', 'SAFETY'];
// Sub-roles under the QC department. PRs from these roles go to QC for the
// first-level approval before flowing on to ADMIN.
const QC_MANAGED_ROLES = ['LAB', 'METROLOGY', 'NDT'];

const createSchema = z.object({
  notes: z.string().optional(),
  // Optional — global-role requesters (STORE_MANAGER, DESIGNS, PLANNING) must
  // specify which unit they are filing the PR for; unit-bound roles ignore this.
  unitId: z.string().uuid().optional().nullable(),
  items: z.array(z.object({
    productName: z.string().min(1),
    productUnit: z.string().min(1).default('pcs'),
    productId: z.string().uuid().optional().nullable(),
    requestedQty: z.number().positive(),
    // PRF form fields
    materialType: z.string().optional(),
    materialSpecification: z.string().optional(),
    // Confidential per-item spec PDF uploaded via POST /upload-spec before submit.
    specAttachmentUrl: z.string().optional().nullable(),
    specAttachmentName: z.string().optional().nullable(),
    qapNo: z.string().optional(),
    drawingNo: z.string().optional(),
    materialRequiredFor: z.string().optional(),
    internalWorkOrder: z.string().optional(),
    purpose: z.string().optional(),
    sourceOfSupply: z.string().optional(),
    scopeOfWork: z.string().optional(),
    inspectionType: z.string().optional(),
    requiredByDate: z.string().optional(),
    itemRemarks: z.string().optional(),
  })).min(1),
});

// POST /api/purchase-requests/upload-spec — uploads a confidential material-spec
// PDF and returns { url, name } so the create form can attach it to the item
// before submitting the PR. Only requester roles (and admin) can upload.
router.post(
  '/upload-spec',
  authenticate,
  authorize('ADMIN', 'MANAGER', 'DESIGNS', 'RND', 'STORE_MANAGER', 'QC', 'SAFETY'),
  (req, res) => {
    prSpecsUpload.single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      res.json({
        url: publicUrlFor('pr-specs', req.file.filename),
        name: req.file.originalname,
      });
    });
  },
);

// GET /api/purchase-requests — list based on role
router.get('/', authenticate, authorize(...CHAIN_ROLES), async (req, res) => {
  try {
    const { status, page, limit, fromDate, toDate } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    applyDateFilter(where, { fromDate, toDate });

    // Role-based filtering — requester roles see only their own.
    // QC is special: in addition to their own PRs they also oversee PRs raised
    // by LAB / METROLOGY / NDT (the sub-roles of the QC department), since
    // QC is the first-level approver for those PRs.
    if (req.user.role === 'QC') {
      where.OR = [
        { managerId: req.user.id },
        { manager: { role: { in: QC_MANAGED_ROLES } } },
      ];
    } else if (OWN_ONLY_ROLES.includes(req.user.role)) {
      where.managerId = req.user.id;
    } else if (req.user.role === 'PURCHASE_OFFICER') {
      // PO sees approved and beyond
      where.status = { in: ['APPROVED', 'IN_PROGRESS', 'QUOTATION_SUBMITTED', 'QUOTATION_APPROVED', 'ORDER_PLACED', 'GOODS_ARRIVED', 'QC_PASSED', 'INWARD_DONE'] };
    } else if (req.user.role === 'ACCOUNTING') {
      where.status = { in: ['QUOTATION_SUBMITTED', 'QUOTATION_APPROVED', 'ORDER_PLACED', 'GOODS_ARRIVED', 'QC_PASSED', 'INWARD_DONE', 'COMPLETED'] };
    }
    // ADMIN and STORE_MANAGER see all

    if (status && !['PURCHASE_OFFICER'].includes(req.user.role)) {
      where.status = status;
    }

    const [requests, total] = await Promise.all([
      prisma.purchaseRequest.findMany({
        where,
        include: {
          manager: { select: { id: true, name: true, username: true, role: true } },
          unit: { select: { id: true, name: true, code: true } },
          qcApprovedBy: { select: { id: true, name: true } },
          adminApprovedBy: { select: { id: true, name: true } },
          items: {
            include: {
              product: { select: { id: true, name: true, sku: true, unit: true, currentStock: true, category: true } },
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

// GET /api/purchase-requests/in-progress-summary — floating in-progress PR/PO counts visible to ALL roles
router.get('/in-progress-summary', authenticate, async (req, res) => {
  try {
    // PR statuses considered "PR pending" — the PR still needs procurement action
    // before the order is in flight. Once admin has approved a quotation and the
    // PO exists (QUOTATION_APPROVED onwards), the PR's procurement work is done;
    // the PO list owns the rest of the lifecycle.
    const prInProgressStatuses = [
      'PENDING_QC', 'PENDING_ADMIN', 'APPROVED', 'QUOTATION_SUBMITTED', 'IN_PROGRESS',
    ];
    const poInProgressStatuses = [
      'PENDING_ACCOUNTING', 'CREDIT_PLACED', 'ORDERED', 'PLACED', 'ADVANCE_PAID',
      'PAYMENT_PENDING', 'PAID', 'GOODS_ARRIVED', 'QC_PENDING', 'QC_PASSED', 'QC_FAILED', 'INWARD_DONE',
    ];

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
      req.user.role === 'QC'
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
      req.user.role === 'QC'
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
      qcPendingCount,
      poAmountAgg,
      prSamples, poSamples,
    ] = await Promise.all([
      prisma.purchaseRequest.count({ where: { status: { in: prInProgressStatuses }, ...prRoleFilter } }),
      prisma.purchaseRequest.count({ where: prRoleFilter }),
      prisma.purchaseOrder.count({ where: { status: { in: poInProgressStatuses }, ...poRoleFilter } }),
      prisma.purchaseOrder.count({ where: poRoleFilter }),
      prisma.purchaseOrder.count({ where: { status: 'QC_PENDING', ...poRoleFilter } }),
      prisma.purchaseOrder.aggregate({
        _sum: { totalAmount: true },
        where: { status: { in: poInProgressStatuses }, ...poRoleFilter },
      }),
      prisma.purchaseRequest.findMany({
        where: { status: { in: prInProgressStatuses }, ...prRoleFilter },
        select: {
          id: true, requestNumber: true, status: true, createdAt: true,
          notes: true,
          manager: { select: { name: true, username: true, role: true } },
          unit: { select: { name: true, code: true } },
          items: { select: { requiredByDate: true, materialRequiredFor: true } },
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
      const requiredFor = (pr.items || []).map(i => i.materialRequiredFor).filter(Boolean)[0] || null;
      // Strip items array from the response — only the derived fields are needed by the UI
      const { items, ...rest } = pr; // eslint-disable-line no-unused-vars
      return { ...rest, earliestRequiredBy: earliest, requiredFor };
    });

    const totalAmountInProgress = poAmountAgg?._sum?.totalAmount || 0;

    res.json({
      prCount, prTotal,
      poCount, poTotal,
      qcPendingCount,
      totalAmountInProgress,
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
        pr: { total: 0, pending: 0, active: 0, completed: 0 },
        po: { total: 0, active: 0, completed: 0 },
      });
    }

    const poUnitWhere = {
      OR: [
        { purchaseRequest: { unitId } },
        { sourceRequests: { some: { purchaseRequest: { unitId } } } },
      ],
    };

    const [
      mivTotal, mivPending, mivApproved,
      prTotal, prPending, prCompleted, prRejected,
      poTotal, poCompleted,
    ] = await Promise.all([
      prisma.productRequest.count({ where: { unitId } }),
      prisma.productRequest.count({ where: { unitId, status: 'PENDING' } }),
      prisma.productRequest.count({ where: { unitId, status: 'APPROVED' } }),
      prisma.purchaseRequest.count({ where: { unitId } }),
      prisma.purchaseRequest.count({ where: { unitId, status: 'PENDING_ADMIN' } }),
      prisma.purchaseRequest.count({ where: { unitId, status: 'COMPLETED' } }),
      prisma.purchaseRequest.count({ where: { unitId, status: 'REJECTED' } }),
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
    } else if (req.user.role === 'ACCOUNTING') {
      where.status = { in: ['QUOTATION_SUBMITTED', 'QUOTATION_APPROVED', 'ORDER_PLACED', 'GOODS_ARRIVED', 'QC_PASSED', 'INWARD_DONE', 'COMPLETED'] };
    }

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
        qcApprovedBy: { select: { id: true, name: true } },
        adminApprovedBy: { select: { id: true, name: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true, unit: true, currentStock: true, category: true } },
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

    // Unit-bound roles (MANAGER, RND) file PRs against their own unit. Global
    // roles (STORE_MANAGER, DESIGNS, PLANNING, QC, LAB, METROLOGY, NDT) file
    // PRs in their own name with no unit attached — their PR is owned by them
    // (managerId) and never shows up on any unit dashboard. STORE_MANAGER's
    // PR is effectively "unassigned" (chain-visible); DESIGNS/PLANNING/QC
    // PRs are own-only. LAB/METROLOGY/NDT PRs are own-only but also visible
    // to QC for first-level approval.
    let unitId = null;
    if (GLOBAL_REQUESTER_ROLES.includes(req.user.role)) {
      unitId = null;
    } else {
      unitId = req.user.unitId || null;
      if (!unitId) {
        return res.status(400).json({ error: 'Your account is not assigned to a unit. Contact admin.' });
      }
    }

    // Resolve productId for each item BEFORE the transactional create:
    //   - if productId given, use it
    //   - else look up an existing product by case-insensitive name
    //   - else create an NRE Product with category-prefixed SKU based on materialType
    // This guarantees every PR item is linked to a Product from day one, so the
    // ownership/category trail is intact through PO → QC → inward.
    const itemsResolved = [];
    for (const item of data.items) {
      const matType = normalizeMaterialType(item.materialType);
      let productId = item.productId || null;
      if (!productId) {
        const existing = await prisma.product.findFirst({
          where: { name: { equals: item.productName, mode: 'insensitive' }, isActive: true },
          select: { id: true, category: true },
        });
        if (existing) {
          productId = existing.id;
        } else {
          // Create NRE product now so SKU is traceable from PR-time onward.
          let createdProduct = null;
          for (let attempt = 0; attempt < 5; attempt++) {
            try {
              const sku = await generateProductSku(prisma, matType);
              createdProduct = await prisma.product.create({
                data: {
                  name: item.productName,
                  sku,
                  unit: item.productUnit || 'pcs',
                  category: matType,
                  currentStock: 0,
                  isActive: true,
                },
              });
              break;
            } catch (err) {
              if (!isUniqueViolation(err) || attempt === 4) throw err;
            }
          }
          productId = createdProduct.id;
        }
      }
      itemsResolved.push({ ...item, productId, materialType: matType });
    }

    // PRs raised by LAB / METROLOGY / NDT enter the QC-approval gate first.
    // Every other requester role goes straight to ADMIN as before.
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
            status: initialStatus,
            notes: data.notes || null,
            items: {
              create: itemsResolved.map(item => ({
                productName: item.productName,
                productUnit: item.productUnit || 'pcs',
                productId: item.productId,
                requestedQty: item.requestedQty,
                materialType: item.materialType,
                materialSpecification: item.materialSpecification || null,
                specAttachmentUrl: item.specAttachmentUrl || null,
                specAttachmentName: item.specAttachmentName || null,
                qapNo: item.qapNo || null,
                drawingNo: item.drawingNo || null,
                materialRequiredFor: item.materialRequiredFor || null,
                internalWorkOrder: item.internalWorkOrder || null,
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
            items: {
              include: { product: { select: { id: true, name: true, sku: true, unit: true, category: true } } },
            },
          },
        });
        break;
      } catch (err) {
        if (!isUniqueViolation(err) || attempt === 4) throw err;
      }
    }
    const requestNumber = request.requestNumber;

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
    if (request.status !== 'PENDING_ADMIN' && request.status !== 'PENDING_QC') {
      return res.status(400).json({ error: 'Only pending requests can be edited' });
    }

    // Re-resolve each item's productId — same rules as create so new rows are
    // linked to a Product (existing match by name, else NRE product created).
    const itemsResolved = [];
    for (const item of data.items) {
      const matType = normalizeMaterialType(item.materialType);
      let productId = item.productId || null;
      if (!productId) {
        const existing = await prisma.product.findFirst({
          where: { name: { equals: item.productName, mode: 'insensitive' }, isActive: true },
          select: { id: true },
        });
        if (existing) {
          productId = existing.id;
        } else {
          let createdProduct = null;
          for (let attempt = 0; attempt < 5; attempt++) {
            try {
              const sku = await generateProductSku(prisma, matType);
              createdProduct = await prisma.product.create({
                data: {
                  name: item.productName,
                  sku,
                  unit: item.productUnit || 'pcs',
                  category: matType,
                  currentStock: 0,
                  isActive: true,
                },
              });
              break;
            } catch (err) {
              if (!isUniqueViolation(err) || attempt === 4) throw err;
            }
          }
          productId = createdProduct.id;
        }
      }
      itemsResolved.push({ ...item, productId, materialType: matType });
    }

    // Swap items in a transaction so a partial failure can't leave the PR with
    // an empty items list. Safe to delete + recreate because PENDING_ADMIN PRs
    // have no quotations, POs or pool memberships referencing their items yet.
    await prisma.$transaction(async (tx) => {
      await tx.purchaseRequestItem.deleteMany({ where: { requestId: request.id } });
      await tx.purchaseRequest.update({
        where: { id: request.id },
        data: {
          notes: data.notes || null,
          items: {
            create: itemsResolved.map(item => ({
              productName: item.productName,
              productUnit: item.productUnit || 'pcs',
              productId: item.productId,
              requestedQty: item.requestedQty,
              materialType: item.materialType,
              materialSpecification: item.materialSpecification || null,
              specAttachmentUrl: item.specAttachmentUrl || null,
              specAttachmentName: item.specAttachmentName || null,
              qapNo: item.qapNo || null,
              drawingNo: item.drawingNo || null,
              materialRequiredFor: item.materialRequiredFor || null,
              internalWorkOrder: item.internalWorkOrder || null,
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

    const updated = await prisma.purchaseRequest.findUnique({
      where: { id: request.id },
      include: {
        manager: { select: { id: true, name: true } },
        unit: { select: { id: true, name: true, code: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true, unit: true, category: true } } } },
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

// PUT /api/purchase-requests/:id/qc-approve — QC department first-level approval
// for PRs raised by LAB / METROLOGY / NDT. On success the PR moves on to ADMIN
// for the second-level approval (status PENDING_QC → PENDING_ADMIN).
router.put('/:id/qc-approve', authenticate, authorize('QC'), async (req, res) => {
  try {
    const { qcNotes } = req.body;

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

    const updated = await prisma.purchaseRequest.update({
      where: { id: req.params.id },
      data: {
        status: 'PENDING_ADMIN',
        qcNotes: qcNotes || null,
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
          targetRole: request.manager.role,
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
        targetRole: request.manager.role,
        sentById: req.user.id,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('QC reject error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/purchase-requests/:id/admin-approve — Admin approves (can change qty + add notes)
router.put('/:id/admin-approve', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const { adminNotes, items } = req.body;

    const request = await prisma.purchaseRequest.findUnique({
      where: { id: req.params.id },
      include: { items: true, manager: { select: { name: true } }, unit: { select: { name: true } } },
    });

    if (!request) return res.status(404).json({ error: 'Purchase request not found' });
    if (request.status !== 'PENDING_ADMIN') {
      return res.status(400).json({ error: 'Only pending requests can be approved' });
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
    const creator = await prisma.user.findUnique({ where: { id: request.managerId }, select: { role: true } });
    await prisma.notification.createMany({
      data: [
        {
          type: 'PURCHASE_REQUEST_APPROVED',
          title: `Purchase Request ${request.requestNumber} Approved`,
          message: `Your purchase request ${request.requestNumber} has been approved by admin.${adminNotes ? ' Notes: ' + adminNotes : ''}`,
          targetRole: creator?.role || 'MANAGER',
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
    const creator = await prisma.user.findUnique({ where: { id: request.managerId }, select: { role: true } });
    await prisma.notification.create({
      data: {
        type: 'PURCHASE_REQUEST_REJECTED',
        title: `Purchase Request ${request.requestNumber} Rejected`,
        message: `Your purchase request ${request.requestNumber} has been rejected. Reason: ${adminNotes || 'No reason provided'}`,
        targetRole: creator?.role || 'MANAGER',
        sentById: req.user.id,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Admin reject error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
      const creator = await prisma.user.findUnique({ where: { id: request.managerId }, select: { role: true } });
      await prisma.notification.create({
        data: {
          type: 'PURCHASE_COMPLETED',
          title: `Purchase Complete: ${request.requestNumber}`,
          message: `All items for purchase request ${request.requestNumber} have been fully purchased.`,
          targetRole: creator?.role || 'MANAGER',
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
    if (request.status !== 'PENDING_ADMIN' && request.status !== 'PENDING_QC') {
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

module.exports = router;
