const express = require('express');
const { z } = require('zod');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { generateOrderNumber, paginate, applyDateFilter } = require('../utils/helpers');
const { prSpecsUpload, publicUrlFor } = require('../middleware/upload');

// Wrap multer so file-validation errors return 400 instead of bubbling to the 500 handler.
const acceptSpecsPdf = (req, res, next) => {
  prSpecsUpload.single('materialSpecsPdf')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'File upload failed' });
    next();
  });
};

const router = express.Router();

// Roles that can create/manage their own purchase requests (same privileges as MANAGER)
const REQUESTER_ROLES = ['MANAGER', 'LAB'];

const createSchema = z.object({
  requestId: z.string().trim().min(1, 'Order name is required'),
  notes: z.string().optional(),
  items: z.array(z.object({
    productName: z.string().min(1),
    productUnit: z.string().min(1).default('pcs'),
    productId: z.string().uuid().optional().nullable(),
    requestedQty: z.number().positive(),
    // PRF form fields
    materialType: z.string().optional(),
    materialSpecification: z.string().optional(),
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

// GET /api/purchase-requests — list based on role
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, page, limit, fromDate, toDate } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    applyDateFilter(where, { fromDate, toDate });

    // Role-based filtering — requester roles see only their own
    if (REQUESTER_ROLES.includes(req.user.role)) {
      where.managerId = req.user.id;
    } else if (req.user.role === 'PURCHASE_OFFICER') {
      // PO sees approved and beyond
      where.status = { in: ['APPROVED', 'IN_PROGRESS', 'QUOTATION_SUBMITTED', 'QUOTATION_APPROVED', 'ORDER_PLACED', 'GOODS_ARRIVED', 'QC_PASSED', 'INWARD_DONE'] };
    } else if (req.user.role === 'ACCOUNTING') {
      where.status = { in: ['QUOTATION_SUBMITTED', 'QUOTATION_APPROVED', 'ORDER_PLACED', 'GOODS_ARRIVED', 'QC_PASSED', 'INWARD_DONE', 'COMPLETED'] };
    } else if (req.user.role === 'QC') {
      where.status = { in: ['GOODS_ARRIVED', 'QC_PASSED'] };
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
          adminApprovedBy: { select: { id: true, name: true } },
          items: {
            include: {
              product: { select: { id: true, name: true, sku: true, unit: true, currentStock: true, category: true } },
            },
          },
          quotations: {
            select: {
              id: true, quotationNumber: true, supplierName: true, totalAmount: true, isSelected: true, isUnion: true,
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
            include: {
              quotation: {
                select: {
                  id: true, quotationNumber: true, supplierName: true, totalAmount: true, isSelected: true, isUnion: true,
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
                      purchaseRequest: {
                        select: { id: true, requestNumber: true, unit: { select: { id: true, name: true, code: true } } },
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

    res.json({
      requests,
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
    // PR statuses considered "in progress" (anything not COMPLETED/REJECTED)
    const prInProgressStatuses = [
      'PENDING_ADMIN', 'APPROVED', 'QUOTATION_SUBMITTED', 'QUOTATION_APPROVED',
      'ORDER_PLACED', 'GOODS_ARRIVED', 'QC_PASSED', 'INWARD_DONE', 'IN_PROGRESS',
    ];
    const poInProgressStatuses = [
      'PENDING_ACCOUNTING', 'ORDERED', 'PLACED', 'ADVANCE_PAID',
      'PAYMENT_PENDING', 'PAID', 'GOODS_ARRIVED', 'QC_PENDING', 'QC_PASSED', 'QC_FAILED', 'INWARD_DONE',
    ];

    const [prCount, poCount, prSamples, poSamples] = await Promise.all([
      prisma.purchaseRequest.count({ where: { status: { in: prInProgressStatuses } } }),
      prisma.purchaseOrder.count({ where: { status: { in: poInProgressStatuses } } }),
      prisma.purchaseRequest.findMany({
        where: { status: { in: prInProgressStatuses } },
        select: {
          id: true, requestNumber: true, requestId: true, status: true, createdAt: true,
          manager: { select: { name: true } },
          unit: { select: { name: true, code: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.purchaseOrder.findMany({
        where: { status: { in: poInProgressStatuses } },
        select: {
          id: true, orderNumber: true, customName: true, supplierName: true,
          status: true, totalAmount: true, createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    res.json({ prCount, poCount, prSamples, poSamples });
  } catch (error) {
    console.error('In-progress summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/purchase-requests/dashboard-stats — stats for PO dashboard
router.get('/dashboard-stats', authenticate, async (req, res) => {
  try {
    const where = {};
    if (REQUESTER_ROLES.includes(req.user.role)) {
      where.managerId = req.user.id;
    } else if (req.user.role === 'PURCHASE_OFFICER') {
      where.status = { in: ['APPROVED', 'IN_PROGRESS', 'QUOTATION_SUBMITTED', 'QUOTATION_APPROVED', 'ORDER_PLACED', 'GOODS_ARRIVED', 'QC_PASSED', 'INWARD_DONE'] };
    } else if (req.user.role === 'ACCOUNTING') {
      where.status = { in: ['QUOTATION_SUBMITTED', 'QUOTATION_APPROVED', 'ORDER_PLACED', 'GOODS_ARRIVED', 'QC_PASSED', 'INWARD_DONE', 'COMPLETED'] };
    } else if (req.user.role === 'QC') {
      where.status = { in: ['GOODS_ARRIVED', 'QC_PASSED'] };
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
router.get('/:id', authenticate, async (req, res) => {
  try {
    const request = await prisma.purchaseRequest.findUnique({
      where: { id: req.params.id },
      include: {
        manager: { select: { id: true, name: true, username: true, role: true, unit: { select: { name: true, code: true } } } },
        unit: { select: { id: true, name: true, code: true } },
        adminApprovedBy: { select: { id: true, name: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true, unit: true, currentStock: true, category: true } },
          },
        },
        quotations: {
          select: {
            id: true, quotationNumber: true, supplierName: true, totalAmount: true, isSelected: true, isUnion: true,
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
          include: {
            quotation: {
              select: {
                id: true, quotationNumber: true, supplierName: true, totalAmount: true, isSelected: true, isUnion: true,
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

    // Requester roles can only view their own
    if (REQUESTER_ROLES.includes(req.user.role) && request.managerId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(request);
  } catch (error) {
    console.error('Get purchase request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/purchase-requests — Requester creates.
// Accepts multipart/form-data (when a material-specs PDF is attached) or JSON.
// In multipart mode the JSON body lives in `payload`.
router.post('/', authenticate, authorize('MANAGER', 'LAB'), acceptSpecsPdf, async (req, res) => {
  try {
    const rawBody = req.is('multipart/form-data') && req.body?.payload
      ? JSON.parse(req.body.payload)
      : req.body;
    const data = createSchema.parse(rawBody);

    if (!req.user.unitId) {
      return res.status(400).json({ error: 'You must be assigned to a unit to create purchase requests' });
    }

    const requestNumber = generateOrderNumber('PR');
    const materialSpecsPdfUrl = req.file ? publicUrlFor('pr-specs', req.file.filename) : null;

    const request = await prisma.purchaseRequest.create({
      data: {
        requestNumber,
        requestId: data.requestId.trim(),
        managerId: req.user.id,
        unitId: req.user.unitId,
        notes: data.notes || null,
        materialSpecsPdfUrl,
        items: {
          create: data.items.map(item => ({
            productName: item.productName,
            productUnit: item.productUnit || 'pcs',
            productId: item.productId || null,
            requestedQty: item.requestedQty,
            materialType: item.materialType || null,
            materialSpecification: item.materialSpecification || null,
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
          include: { product: { select: { id: true, name: true, sku: true, unit: true } } },
        },
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'CREATE',
        entity: 'PurchaseRequest',
        entityId: request.id,
        details: {
          requestNumber,
          unit: req.user.unit?.code,
          itemCount: data.items.length,
        },
        ipAddress: req.ip,
      },
    });

    // Notify admins
    await prisma.notification.create({
      data: {
        type: 'NEW_PURCHASE_REQUEST',
        title: `New Purchase Request: ${requestNumber}`,
        message: `${req.user.name} (${req.user.unit?.name}) has submitted a purchase request with ${data.items.length} item(s) for admin approval.`,
        targetRole: 'ADMIN',
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
          message: `Purchase request ${request.requestNumber} from ${request.manager.name} (${request.unit.name}) has been approved. Please proceed with procurement.`,
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
router.put('/:id/cancel', authenticate, authorize('MANAGER', 'LAB'), async (req, res) => {
  try {
    const request = await prisma.purchaseRequest.findUnique({
      where: { id: req.params.id },
    });

    if (!request) return res.status(404).json({ error: 'Purchase request not found' });
    if (request.managerId !== req.user.id) {
      return res.status(403).json({ error: 'You can only cancel your own requests' });
    }
    if (request.status !== 'PENDING_ADMIN') {
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

module.exports = router;
