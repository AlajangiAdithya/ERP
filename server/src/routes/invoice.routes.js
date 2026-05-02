const express = require('express');
const { z } = require('zod');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorizeMinRole } = require('../middleware/rbac');
const { auditLog } = require('../middleware/audit');
const { generateOrderNumber, paginate } = require('../utils/helpers');

const router = express.Router();

// GET /api/invoices
router.get('/', authenticate, async (req, res) => {
  try {
    const { search, status, page, limit } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { saleOrder: { customer: { name: { contains: search, mode: 'insensitive' } } } },
      ];
    }

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: {
          saleOrder: {
            select: { id: true, orderNumber: true, customer: { select: { id: true, name: true } } },
          },
        },
        orderBy: { issueDate: 'desc' },
        skip,
        take,
      }),
      prisma.invoice.count({ where }),
    ]);

    res.json({ invoices, total, page: Math.ceil(skip / take) + 1, totalPages: Math.ceil(total / take) });
  } catch (error) {
    console.error('Get invoices error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/invoices/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: {
        saleOrder: {
          include: {
            customer: true,
            items: { include: { product: { select: { id: true, name: true, sku: true, unit: true, hsnCode: true } } } },
          },
        },
      },
    });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json(invoice);
  } catch (error) {
    console.error('Get invoice error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/invoices/from-sale/:saleOrderId
router.post('/from-sale/:saleOrderId', authenticate, authorizeMinRole('STAFF'), auditLog('CREATE', 'Invoice'), async (req, res) => {
  try {
    const saleOrder = await prisma.saleOrder.findUnique({
      where: { id: req.params.saleOrderId },
      include: { invoice: true },
    });

    if (!saleOrder) return res.status(404).json({ error: 'Sale order not found' });
    if (saleOrder.invoice) return res.status(400).json({ error: 'Invoice already exists for this sale order' });
    if (saleOrder.status === 'DRAFT' || saleOrder.status === 'CANCELLED') {
      return res.status(400).json({ error: 'Cannot create invoice for draft/cancelled orders' });
    }

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: generateOrderNumber('INV'),
        saleOrderId: saleOrder.id,
        subtotal: saleOrder.subtotal,
        taxAmount: saleOrder.taxAmount,
        totalAmount: saleOrder.totalAmount,
        dueDate,
      },
      include: {
        saleOrder: { include: { customer: true } },
      },
    });

    res.status(201).json(invoice);
  } catch (error) {
    console.error('Create invoice error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/invoices/:id/payment
router.put('/:id/payment', authenticate, authorizeMinRole('STAFF'), auditLog('UPDATE', 'Invoice'), async (req, res) => {
  try {
    const { amount } = z.object({ amount: z.number().positive() }).parse(req.body);

    const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (invoice.status === 'PAID' || invoice.status === 'CANCELLED') {
      return res.status(400).json({ error: 'Cannot record payment for this invoice' });
    }

    const newPaidAmount = invoice.paidAmount + amount;
    const status = newPaidAmount >= invoice.totalAmount ? 'PAID' : 'PARTIALLY_PAID';

    const updated = await prisma.invoice.update({
      where: { id: req.params.id },
      data: { paidAmount: newPaidAmount, status },
    });

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input', details: error.errors });
    console.error('Record payment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
