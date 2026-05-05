const express = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { paginate } = require('../utils/helpers');

const router = express.Router();

// GET /api/alerts/low-stock — products below min stock level
router.get('/low-stock', authenticate, async (req, res) => {
  try {
    const products = await prisma.$queryRaw`
      SELECT p.id, p.name, p.sku, p.category, p.unit,
             p."currentStock", p."minStockLevel",
             CASE
               WHEN p."currentStock" = 0 THEN 'Out of Stock'
               WHEN p."minStockLevel" > 0 AND p."currentStock" <= p."minStockLevel" * 0.5 THEN 'Critical'
               WHEN p."minStockLevel" > 0 AND p."currentStock" <= p."minStockLevel" THEN 'Low'
               ELSE 'Low'
             END as "stockStatus"
      FROM "Product" p
      WHERE p."isActive" = true
        AND (
          (p."minStockLevel" > 0 AND p."currentStock" <= p."minStockLevel")
          OR p."currentStock" = 0
        )
      ORDER BY
        CASE WHEN p."currentStock" = 0 THEN 0 ELSE 1 END,
        p."currentStock" / NULLIF(p."minStockLevel", 0) ASC NULLS LAST
    `;
    res.json(products);
  } catch (error) {
    console.error('Get low stock error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/alerts/low-stock-notify — Store Manager sends low-stock alert to Admin
router.post('/low-stock-notify', authenticate, authorize('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { productId, message } = req.body;

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) return res.status(404).json({ error: 'Product not found' });

    // Check if unread notification already exists
    const existing = await prisma.notification.findFirst({
      where: { productId, isRead: false, type: 'LOW_STOCK', targetRole: 'ADMIN' },
    });

    if (existing) {
      return res.status(400).json({ error: 'An unread low-stock notification already exists for this product' });
    }

    const severity = product.currentStock === 0 ? 'OUT OF STOCK' :
      (product.minStockLevel > 0 && product.currentStock <= product.minStockLevel * 0.5) ? 'CRITICAL' : 'LOW';

    const notification = await prisma.notification.create({
      data: {
        type: 'LOW_STOCK',
        title: `${severity}: ${product.name}`,
        message: message || `${product.name} (${product.sku}) stock is at ${product.currentStock} ${product.unit}. Minimum level: ${product.minStockLevel}. Immediate action required.`,
        productId,
        targetRole: 'ADMIN',
        sentById: req.user.id,
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'CREATE',
        entity: 'Notification',
        entityId: notification.id,
        details: { type: 'LOW_STOCK', product: product.name, severity },
        ipAddress: req.ip,
      },
    });

    res.status(201).json(notification);
  } catch (error) {
    console.error('Low stock notify error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ──── NOTIFICATIONS ────

// GET /api/alerts/notifications — get notifications (filtered by user role)
router.get('/notifications', authenticate, async (req, res) => {
  try {
    const { page, limit } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {
      OR: [
        { targetRole: req.user.role },
        { targetUserId: req.user.id },
        { targetRole: null, targetUserId: null },
      ],
    };

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        include: { sentBy: { select: { id: true, name: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { ...where, isRead: false } }),
    ]);

    res.json({ notifications, total, unreadCount, page: Math.ceil(skip / take) + 1, totalPages: Math.ceil(total / take) });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/alerts/notifications/unread-count
router.get('/notifications/unread-count', authenticate, async (req, res) => {
  try {
    const count = await prisma.notification.count({
      where: {
        isRead: false,
        OR: [
          { targetRole: req.user.role },
          { targetUserId: req.user.id },
          { targetRole: null, targetUserId: null },
        ],
      },
    });
    res.json({ count });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/alerts/notifications/:id/read — mark as read
router.put('/notifications/:id/read', authenticate, async (req, res) => {
  try {
    await prisma.notification.update({
      where: { id: req.params.id },
      data: { isRead: true },
    });
    res.json({ message: 'Marked as read' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Notification not found' });
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/alerts/notifications/mark-all-read
router.put('/notifications/mark-all-read', authenticate, async (req, res) => {
  try {
    await prisma.notification.updateMany({
      where: {
        isRead: false,
        OR: [
          { targetRole: req.user.role },
          { targetUserId: req.user.id },
          { targetRole: null, targetUserId: null },
        ],
      },
      data: { isRead: true },
    });
    res.json({ message: 'All marked as read' });
  } catch (error) {
    console.error('Mark all read error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
