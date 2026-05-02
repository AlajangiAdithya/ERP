const express = require('express');
const { z } = require('zod');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorizeMinRole } = require('../middleware/rbac');
const { auditLog } = require('../middleware/audit');
const { paginate } = require('../utils/helpers');

const router = express.Router();

const customerSchema = z.object({
  name: z.string().min(1),
  contactPerson: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  gstNumber: z.string().optional(),
});

// GET /api/customers
router.get('/', authenticate, async (req, res) => {
  try {
    const { search, page, limit } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = { isActive: true };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { contactPerson: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        include: { _count: { select: { saleOrders: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.customer.count({ where }),
    ]);

    res.json({ customers, total, page: Math.ceil(skip / take) + 1, totalPages: Math.ceil(total / take) });
  } catch (error) {
    console.error('Get customers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/customers/all
router.get('/all', authenticate, async (req, res) => {
  try {
    const customers = await prisma.customer.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    res.json(customers);
  } catch (error) {
    console.error('Get all customers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/customers/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id },
      include: {
        saleOrders: { orderBy: { orderDate: 'desc' }, take: 10, include: { invoice: true } },
      },
    });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    res.json(customer);
  } catch (error) {
    console.error('Get customer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/customers
router.post('/', authenticate, authorizeMinRole('STAFF'), auditLog('CREATE', 'Customer'), async (req, res) => {
  try {
    const data = customerSchema.parse(req.body);
    const customer = await prisma.customer.create({ data });
    res.status(201).json(customer);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input', details: error.errors });
    console.error('Create customer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/customers/:id
router.put('/:id', authenticate, authorizeMinRole('STAFF'), auditLog('UPDATE', 'Customer'), async (req, res) => {
  try {
    const data = customerSchema.partial().parse(req.body);
    const customer = await prisma.customer.update({ where: { id: req.params.id }, data });
    res.json(customer);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input', details: error.errors });
    if (error.code === 'P2025') return res.status(404).json({ error: 'Customer not found' });
    console.error('Update customer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/customers/:id (soft delete)
router.delete('/:id', authenticate, authorizeMinRole('MANAGER'), auditLog('DELETE', 'Customer'), async (req, res) => {
  try {
    await prisma.customer.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ message: 'Customer deactivated' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Customer not found' });
    console.error('Delete customer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
