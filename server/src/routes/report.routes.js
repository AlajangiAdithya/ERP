const express = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { paginate } = require('../utils/helpers');

const router = express.Router();

// GET /api/reports/dashboard
router.get('/dashboard', authenticate, async (req, res) => {
  try {
    const [
      totalProducts,
      lowStockProducts,
      totalUsers,
      pendingRequests,
      recentMovements,
      recentRequests,
    ] = await Promise.all([
      prisma.product.count({ where: { isActive: true } }),

      prisma.$queryRaw`
        SELECT COUNT(*)::int as count FROM "Product"
        WHERE "isActive" = true AND "currentStock" <= "minStockLevel" AND "minStockLevel" > 0
      `,

      prisma.user.count({ where: { isActive: true } }),

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
    ]);

    const lowStockCount = lowStockProducts[0]?.count || 0;

    // Stock movement trends (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const movementTrends = await prisma.$queryRaw`
      SELECT 
        DATE("createdAt") as date,
        type,
        SUM(quantity) as total_quantity,
        COUNT(*)::int as count
      FROM "StockMovement"
      WHERE "createdAt" >= ${sevenDaysAgo}
      GROUP BY DATE("createdAt"), type
      ORDER BY DATE("createdAt") ASC
    `;

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
router.get('/unit-usage', authenticate, authorize('ADMIN'), async (req, res) => {
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

// GET /api/reports/audit-logs — Admin: full audit logs
router.get('/audit-logs', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const { userId, action, entity, page, limit, startDate, endDate } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    if (userId) where.userId = userId;
    if (action) where.action = action;
    if (entity) where.entity = entity;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

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
router.get('/unit-summary', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const units = await prisma.unit.findMany({
      where: { isActive: true },
      include: {
        _count: { select: { users: true, productRequests: true } },
      },
    });

    const summaries = await Promise.all(units.map(async (unit) => {
      const totalOut = await prisma.stockMovement.aggregate({
        where: { unitId: unit.id, type: 'OUT' },
        _sum: { quantity: true },
        _count: true,
      });

      const requestStats = await prisma.productRequest.groupBy({
        by: ['status'],
        where: { unitId: unit.id },
        _count: true,
      });

      return {
        id: unit.id,
        name: unit.name,
        code: unit.code,
        totalUsers: unit._count.users,
        totalRequests: unit._count.productRequests,
        totalItemsConsumed: totalOut._sum.quantity || 0,
        totalMovements: totalOut._count,
        requestStats: requestStats.reduce((acc, s) => { acc[s.status] = s._count; return acc; }, {}),
      };
    }));

    res.json(summaries);
  } catch (error) {
    console.error('Unit summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
