const express = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { paginate, applyDateFilter } = require('../utils/helpers');
const { HIDDEN_ROLES } = require('../utils/hiddenRoles');

const router = express.Router();

// GET /api/reports/dashboard
router.get('/dashboard', authenticate, async (req, res) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [
      totalProducts,
      lowStockProducts,
      totalUsers,
      pendingRequests,
      recentMovements,
      recentRequests,
      movementTrends,
    ] = await Promise.all([
      prisma.product.count({ where: { isActive: true } }),

      prisma.$queryRaw`
        SELECT COUNT(*)::int as count FROM "Product"
        WHERE "isActive" = true AND (
          ("minStockLevel" > 0 AND "currentStock" <= "minStockLevel")
          OR "currentStock" = 0
        )
      `,

      prisma.user.count({ where: { isActive: true, role: { notIn: HIDDEN_ROLES } } }),

      prisma.productRequest.count({ where: { status: 'PENDING' } }),

      prisma.stockMovement.findMany({
        include: { product: { select: { name: true, sku: true, unit: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),

      prisma.productRequest.findMany({
        include: {
          manager: { select: { name: true } },
          unit: { select: { name: true, code: true } },
          items: { include: { product: { select: { name: true, unit: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),

      prisma.$queryRaw`
        SELECT
          DATE("createdAt") as date,
          type,
          SUM(quantity) as total_quantity,
          COUNT(*)::int as count
        FROM "StockMovement"
        WHERE "createdAt" >= ${sevenDaysAgo}
        GROUP BY DATE("createdAt"), type
        ORDER BY DATE("createdAt") ASC
      `,
    ]);

    const lowStockCount = lowStockProducts[0]?.count || 0;

    res.json({
      stats: {
        totalProducts,
        lowStockAlerts: lowStockCount,
        totalUsers,
        pendingRequests,
      },
      movementTrends,
      recentMovements,
      recentRequests,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/unit-usage — Admin: unit-wise product consumption
router.get('/unit-usage', authenticate, authorize('ADMIN', 'SAFETY'), async (req, res) => {
  try {
    const { unitId, page, limit, startDate, endDate } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {
      type: 'OUT',
      referenceType: 'ProductRequest',
    };
    if (unitId) where.unitId = unitId;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [movements, total] = await Promise.all([
      prisma.stockMovement.findMany({
        where,
        include: {
          product: { select: { id: true, name: true, sku: true, unit: true, category: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.stockMovement.count({ where }),
    ]);

    // Enrich with unit & user info from referenceId (ProductRequest)
    const enriched = await Promise.all(movements.map(async (m) => {
      let request = null;
      if (m.referenceId) {
        request = await prisma.productRequest.findUnique({
          where: { id: m.referenceId },
          select: {
            requestNumber: true,
            manager: { select: { name: true } },
            unit: { select: { name: true, code: true } },
          },
        });
      }
      return {
        ...m,
        managerName: request?.manager?.name || 'Unknown',
        unitName: request?.unit?.name || 'Unknown',
        unitCode: request?.unit?.code || '-',
        requestNumber: request?.requestNumber || '-',
      };
    }));

    res.json({ movements: enriched, total, page: Math.ceil(skip / take) + 1, totalPages: Math.ceil(total / take) });
  } catch (error) {
    console.error('Unit usage error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/audit-logs — Admin / Safety / Planning / Accounting / Finance: full audit logs (read-only)
router.get('/audit-logs', authenticate, authorize('ADMIN', 'SAFETY', 'PLANNING', 'ACCOUNTING', 'FINANCE'), async (req, res) => {
  try {
    const { userId, action, entity, page, limit, fromDate, toDate, startDate, endDate } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    if (userId) where.userId = userId;
    if (action) where.action = action;
    if (entity) where.entity = entity;
    applyDateFilter(where, { fromDate: fromDate || startDate, toDate: toDate || endDate });

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: {
              id: true, name: true, username: true, role: true,
              unit: { select: { name: true, code: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({ logs, total, page: Math.ceil(skip / take) + 1, totalPages: Math.ceil(total / take) });
  } catch (error) {
    console.error('Audit logs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/unit-summary — Admin: summary of unit-wise consumption
router.get('/unit-summary', authenticate, authorize('ADMIN', 'SAFETY'), async (req, res) => {
  try {
    const summaries = await prisma.$queryRaw`
      SELECT
        u.id,
        u.name,
        u.code,
        COALESCE(uc.user_count, 0)::int AS "totalUsers",
        COALESCE(rc.req_count, 0)::int AS "totalRequests",
        COALESCE(sm.total_qty, 0) AS "totalItemsConsumed"
      FROM "Unit" u
      LEFT JOIN (
        SELECT "unitId", COUNT(*)::int AS user_count
        FROM "User" WHERE "isActive" = true
        GROUP BY "unitId"
      ) uc ON uc."unitId" = u.id
      LEFT JOIN (
        SELECT "unitId", COUNT(*)::int AS req_count
        FROM "ProductRequest"
        GROUP BY "unitId"
      ) rc ON rc."unitId" = u.id
      LEFT JOIN (
        SELECT "unitId", SUM(quantity) AS total_qty
        FROM "StockMovement" WHERE type = 'OUT'
        GROUP BY "unitId"
      ) sm ON sm."unitId" = u.id
      WHERE u."isActive" = true
      ORDER BY u.name ASC
    `;

    res.json(summaries);
  } catch (error) {
    console.error('Unit summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
