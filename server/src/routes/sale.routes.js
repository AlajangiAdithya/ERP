const express = require('express');
const { z } = require('zod');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorizeMinRole } = require('../middleware/rbac');
const { auditLog } = require('../middleware/audit');
const { generateOrderNumber, paginate } = require('../utils/helpers');

const router = express.Router();

const saleOrderSchema = z.object({
  customerId: z.string().uuid(),
  notes: z.string().optional(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().positive(),
    unitPrice: z.number().min(0),
    taxPercent: z.number().min(0).max(100).optional(),
  })).min(1),
});

// GET /api/sales
router.get('/', authenticate, async (req, res) => {
  try {
    const { search, status, page, limit } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [orders, total] = await Promise.all([
      prisma.saleOrder.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true } },
          invoice: { select: { id: true, invoiceNumber: true, status: true } },
          _count: { select: { items: true } },
        },
        orderBy: { orderDate: 'desc' },
        skip,
        take,
      }),
      prisma.saleOrder.count({ where }),
    ]);

    res.json({ orders, total, page: Math.ceil(skip / take) + 1, totalPages: Math.ceil(total / take) });
  } catch (error) {
    console.error('Get sale orders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/sales/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const order = await prisma.saleOrder.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
        items: { include: { product: { select: { id: true, name: true, sku: true, unit: true, currentStock: true } } } },
        invoice: true,
      },
    });
    if (!order) return res.status(404).json({ error: 'Sale order not found' });
    res.json(order);
  } catch (error) {
    console.error('Get sale order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/sales
router.post('/', authenticate, authorizeMinRole('STAFF'), auditLog('CREATE', 'SaleOrder'), async (req, res) => {
  try {
    const data = saleOrderSchema.parse(req.body);

    const items = data.items.map(item => {
      const tax = item.taxPercent || 0;
      const totalPrice = item.quantity * item.unitPrice * (1 + tax / 100);
      return { ...item, taxPercent: tax, totalPrice };
    });

    const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
    const taxAmount = items.reduce((sum, i) => sum + (i.totalPrice - i.quantity * i.unitPrice), 0);
    const totalAmount = subtotal + taxAmount;

    const order = await prisma.saleOrder.create({
      data: {
        orderNumber: generateOrderNumber('SO'),
        customerId: data.customerId,
        notes: data.notes,
        subtotal,
        taxAmount,
        totalAmount,
        items: { create: items },
      },
      include: { customer: true, items: { include: { product: true } } },
    });

    res.status(201).json(order);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input', details: error.errors });
    console.error('Create SO error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/sales/:id/status
router.put('/:id/status', authenticate, authorizeMinRole('STAFF'), auditLog('UPDATE', 'SaleOrder'), async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['DRAFT', 'CONFIRMED', 'DISPATCHED', 'DELIVERED', 'CANCELLED'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    // When confirming, deduct stock
    if (status === 'CONFIRMED') {
      const order = await prisma.saleOrder.findUnique({
        where: { id: req.params.id },
        include: { items: true },
      });

      if (order.status !== 'DRAFT') return res.status(400).json({ error: 'Can only confirm draft orders' });

      for (const item of order.items) {
        const product = await prisma.product.findUnique({ where: { id: item.productId } });
        if (product.currentStock < item.quantity) {
          return res.status(400).json({ error: `Insufficient stock for ${product.name}` });
        }
      }

      await prisma.$transaction(
        order.items.flatMap(item => [
          prisma.product.update({
            where: { id: item.productId },
            data: { currentStock: { decrement: item.quantity } },
          }),
          prisma.stockMovement.create({
            data: {
              productId: item.productId,
              type: 'OUT',
              quantity: item.quantity,
              referenceType: 'SaleOrder',
              referenceId: order.id,
              notes: `Sale Order ${order.orderNumber}`,
            },
          }),
        ])
      );
    }

    const updated = await prisma.saleOrder.update({
      where: { id: req.params.id },
      data: { status },
    });
    res.json(updated);
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Sale order not found' });
    console.error('Update SO status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/sales/:id
router.delete('/:id', authenticate, authorizeMinRole('MANAGER'), auditLog('DELETE', 'SaleOrder'), async (req, res) => {
  try {
    const order = await prisma.saleOrder.findUnique({ where: { id: req.params.id } });
    if (!order) return res.status(404).json({ error: 'Sale order not found' });
    if (order.status !== 'DRAFT') return res.status(400).json({ error: 'Can only delete draft orders' });

    await prisma.saleOrder.delete({ where: { id: req.params.id } });
    res.json({ message: 'Sale order deleted' });
  } catch (error) {
    console.error('Delete SO error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
