// ──────────────────────────────────────────────────────────────
// Metrology — Calibration Item registry
// Write access: METROLOGY + ADMIN. Everyone else listed below
// gets read-only access (procurement chain + safety).
// ──────────────────────────────────────────────────────────────
const express = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');

const router = express.Router();

const WRITE_ROLES = ['METROLOGY', 'ADMIN'];
const READ_ROLES = [
  'METROLOGY', 'ADMIN', 'MANAGER', 'STORE_MANAGER',
  'PURCHASE_OFFICER', 'QC', 'ACCOUNTING', 'SAFETY',
  'LAB', 'NDT', 'RND', 'DESIGNS',
];

const VALID_CATEGORIES = [
  'PRESSURE_GAUGE',
  'VACUUM_GAUGE',
  'WEIGHING_BALANCE',
  'TESTING_EQUIPMENT',
  'METROLOGY_INSTRUMENT',
  'MMR',
];

const parseDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const sanitize = (body, { partial = false } = {}) => {
  const data = {};
  const set = (k, transform = (x) => x) => {
    if (body[k] !== undefined) data[k] = body[k] === null || body[k] === '' ? null : transform(body[k]);
  };

  if (!partial || body.category !== undefined) {
    if (!VALID_CATEGORIES.includes(body.category)) {
      throw new Error('Invalid category');
    }
    data.category = body.category;
  }
  if (!partial || body.name !== undefined) {
    if (!body.name || !String(body.name).trim()) {
      throw new Error('Name is required');
    }
    data.name = String(body.name).trim();
  }

  ['make', 'model', 'serialNo', 'rapsplSerialNo', 'operatingRange',
   'capacityMin', 'capacityMax', 'leastCount', 'unitLocation',
   'usedFor', 'calibrationCertificate', 'notes'].forEach((k) => set(k, (v) => String(v).trim()));

  ['calibrationOn', 'calibrationDueDate', 'recallDueDate'].forEach((k) => set(k, parseDate));

  if (body.periodicity !== undefined) {
    data.periodicity = body.periodicity ? String(body.periodicity).trim() : 'Every One Year';
  }
  if (body.isActive !== undefined) data.isActive = !!body.isActive;

  return data;
};

// GET /api/calibration — list, optional ?category=&search=
router.get('/', authenticate, authorize(...READ_ROLES), async (req, res) => {
  try {
    const { category, search, unit } = req.query;
    const where = {};
    if (category && VALID_CATEGORIES.includes(category)) where.category = category;
    if (unit) where.unitLocation = unit;
    if (search) {
      const q = String(search).trim();
      if (q) {
        where.OR = [
          { name:           { contains: q, mode: 'insensitive' } },
          { make:           { contains: q, mode: 'insensitive' } },
          { model:          { contains: q, mode: 'insensitive' } },
          { serialNo:       { contains: q, mode: 'insensitive' } },
          { rapsplSerialNo: { contains: q, mode: 'insensitive' } },
          { usedFor:        { contains: q, mode: 'insensitive' } },
        ];
      }
    }

    const items = await prisma.calibrationItem.findMany({
      where,
      orderBy: [{ unitLocation: 'asc' }, { createdAt: 'asc' }],
    });
    res.json({ items });
  } catch (error) {
    console.error('List calibration items error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/calibration/:id
router.get('/:id', authenticate, authorize(...READ_ROLES), async (req, res) => {
  try {
    const item = await prisma.calibrationItem.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ error: 'Calibration item not found' });
    res.json(item);
  } catch (error) {
    console.error('Get calibration item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/calibration — METROLOGY/ADMIN
router.post('/', authenticate, authorize(...WRITE_ROLES), async (req, res) => {
  try {
    const data = sanitize(req.body, { partial: false });
    const item = await prisma.calibrationItem.create({ data });
    res.status(201).json(item);
  } catch (error) {
    if (error.message === 'Invalid category' || error.message === 'Name is required') {
      return res.status(400).json({ error: error.message });
    }
    console.error('Create calibration item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/calibration/:id — METROLOGY/ADMIN
router.put('/:id', authenticate, authorize(...WRITE_ROLES), async (req, res) => {
  try {
    const existing = await prisma.calibrationItem.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Calibration item not found' });

    const data = sanitize(req.body, { partial: true });
    const item = await prisma.calibrationItem.update({ where: { id: req.params.id }, data });
    res.json(item);
  } catch (error) {
    if (error.message === 'Invalid category' || error.message === 'Name is required') {
      return res.status(400).json({ error: error.message });
    }
    console.error('Update calibration item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/calibration/:id — METROLOGY/ADMIN
router.delete('/:id', authenticate, authorize(...WRITE_ROLES), async (req, res) => {
  try {
    await prisma.calibrationItem.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Calibration item not found' });
    console.error('Delete calibration item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
