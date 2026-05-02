const express = require('express');
const { z } = require('zod');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { auditLog } = require('../middleware/audit');

const router = express.Router();

const unitSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
});

// GET /api/units
router.get('/', authenticate, async (req, res) => {
  try {
    const units = await prisma.unit.findMany({
      where: { isActive: true },
      include: { _count: { select: { users: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(units);
  } catch (error) {
    console.error('Get units error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/units/all (includes inactive)
router.get('/all', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const units = await prisma.unit.findMany({
      include: {
        _count: { select: { users: true } },
        users: { select: { id: true, name: true, role: true, isActive: true } },
      },
      orderBy: { name: 'asc' },
    });
    res.json(units);
  } catch (error) {
    console.error('Get all units error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/units
router.post('/', authenticate, authorize('ADMIN'), auditLog('CREATE', 'Unit'), async (req, res) => {
  try {
    const data = unitSchema.parse(req.body);
    const unit = await prisma.unit.create({ data });
    res.status(201).json(unit);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Unit name or code already exists' });
    }
    console.error('Create unit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/units/:id
router.put('/:id', authenticate, authorize('ADMIN'), auditLog('UPDATE', 'Unit'), async (req, res) => {
  try {
    const data = unitSchema.partial().parse(req.body);
    const unit = await prisma.unit.update({
      where: { id: req.params.id },
      data,
    });
    res.json(unit);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    if (error.code === 'P2025') return res.status(404).json({ error: 'Unit not found' });
    if (error.code === 'P2002') return res.status(409).json({ error: 'Unit name or code already exists' });
    console.error('Update unit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/units/:id (soft delete)
router.delete('/:id', authenticate, authorize('ADMIN'), auditLog('DELETE', 'Unit'), async (req, res) => {
  try {
    await prisma.unit.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json({ message: 'Unit deactivated' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Unit not found' });
    console.error('Delete unit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
