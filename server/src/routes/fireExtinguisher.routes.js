// ──────────────────────────────────────────────────────────────
// Fire Extinguisher register — sister tab to the Machinery register.
// Access model is identical: SAFETY + Unit-5 edit, everyone else views.
// ──────────────────────────────────────────────────────────────
const express = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { amcDocUpload, publicUrlFor } = require('../middleware/upload');

const router = express.Router();

const EDIT_UNIT_CODES = ['5', 'UNIT-V', 'UNIT-5'];
const EDIT_UNIT_NAMES = ['unit 5', 'unit-5', 'unit5', 'unit v'];

const unitCodeOf = (user) => (user?.unit?.code || '').toString().toUpperCase();
const unitNameOf = (user) => (user?.unit?.name || '').toString().trim().toLowerCase();
const usernameOf = (user) => (user?.username || '').toString().trim().toLowerCase();

const isUnit5 = (user) => {
  if (!user) return false;
  if (EDIT_UNIT_CODES.includes(unitCodeOf(user))) return true;
  if (EDIT_UNIT_NAMES.includes(unitNameOf(user))) return true;
  if (EDIT_UNIT_NAMES.includes(usernameOf(user))) return true;
  return false;
};

const canWrite = (user) => {
  if (!user) return false;
  if (user.role === 'SUPERADMIN') return true;
  if (user.role === 'SAFETY') return true;
  if (isUnit5(user)) return true;
  return false;
};

const requireWrite = (req, res, next) => {
  if (!canWrite(req.user)) return res.status(403).json({ error: 'Forbidden' });
  next();
};

const toDate = (v) => (v ? new Date(v) : null);
const trimOrNull = (v) => {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === '' ? null : s;
};

router.get('/', authenticate, async (req, res) => {
  try {
    const items = await prisma.fireExtinguisher.findMany({
      orderBy: [{ unit: 'asc' }, { serialNumber: 'asc' }, { createdAt: 'asc' }],
    });
    res.json({ items, canWrite: canWrite(req.user) });
  } catch (error) {
    console.error('List fire extinguishers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', authenticate, requireWrite, async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.type?.trim()) return res.status(400).json({ error: 'Type is required' });
    if (!body.capacity?.trim()) return res.status(400).json({ error: 'Capacity is required' });
    if (!body.rapsId?.trim()) return res.status(400).json({ error: 'RAPS ID is required' });
    if (!body.unit?.trim()) return res.status(400).json({ error: 'Unit is required' });

    const rapsId = body.rapsId.trim();
    const clash = await prisma.fireExtinguisher.findUnique({ where: { rapsId } });
    if (clash) return res.status(400).json({ error: 'A fire extinguisher with this RAPS ID already exists' });

    let serialNumber = parseInt(body.serialNumber, 10);
    if (!Number.isFinite(serialNumber) || serialNumber <= 0) {
      const lastInUnit = await prisma.fireExtinguisher.findFirst({
        where: { unit: body.unit.trim() },
        orderBy: { serialNumber: 'desc' },
      });
      serialNumber = (lastInUnit?.serialNumber || 0) + 1;
    }

    const item = await prisma.fireExtinguisher.create({
      data: {
        serialNumber,
        type: body.type.trim(),
        capacity: body.capacity.trim(),
        rapsId,
        unit: body.unit.trim(),
        location: trimOrNull(body.location) ?? null,
        refilledOn: toDate(body.refilledOn),
        nextDueOn: toDate(body.nextDueOn),
        createdById: req.user.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'FIRE_EXTINGUISHER_CREATE',
        entity: 'FireExtinguisher',
        entityId: item.id,
        details: { rapsId: item.rapsId, unit: item.unit },
        ipAddress: req.ip,
      },
    });

    res.status(201).json(item);
  } catch (error) {
    console.error('Create fire extinguisher error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', authenticate, requireWrite, async (req, res) => {
  try {
    const existing = await prisma.fireExtinguisher.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Fire extinguisher not found' });

    const body = req.body || {};
    const data = {};

    if (body.serialNumber !== undefined) {
      const n = parseInt(body.serialNumber, 10);
      if (Number.isFinite(n) && n > 0) data.serialNumber = n;
    }
    if (body.rapsId !== undefined) {
      const rapsId = body.rapsId?.trim();
      if (!rapsId) return res.status(400).json({ error: 'RAPS ID cannot be empty' });
      if (rapsId !== existing.rapsId) {
        const clash = await prisma.fireExtinguisher.findUnique({ where: { rapsId } });
        if (clash) return res.status(400).json({ error: 'Another fire extinguisher already has this RAPS ID' });
      }
      data.rapsId = rapsId;
    }
    ['type', 'capacity', 'unit'].forEach((k) => {
      if (body[k] !== undefined) {
        if (!body[k]?.trim()) return res.status(400).json({ error: `${k} cannot be empty` });
        data[k] = body[k].trim();
      }
    });
    if (body.location !== undefined) data.location = trimOrNull(body.location) ?? null;
    if (body.refilledOn !== undefined) data.refilledOn = toDate(body.refilledOn);
    if (body.nextDueOn !== undefined) data.nextDueOn = toDate(body.nextDueOn);
    if (body.attachment === null || body.attachment === '') data.attachment = null;

    const item = await prisma.fireExtinguisher.update({ where: { id: req.params.id }, data });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'FIRE_EXTINGUISHER_UPDATE',
        entity: 'FireExtinguisher',
        entityId: item.id,
        details: { rapsId: item.rapsId, changes: Object.keys(data) },
        ipAddress: req.ip,
      },
    });

    res.json(item);
  } catch (error) {
    console.error('Update fire extinguisher error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post(
  '/:id/document',
  authenticate,
  requireWrite,
  amcDocUpload.single('document'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Document is required (PDF/PNG/JPG)' });
      const url = publicUrlFor('amc-docs', req.file.filename);
      const item = await prisma.fireExtinguisher.update({
        where: { id: req.params.id },
        data: { attachment: url },
      });
      res.json(item);
    } catch (error) {
      console.error('Upload FE doc error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.delete('/:id', authenticate, requireWrite, async (req, res) => {
  try {
    const item = await prisma.fireExtinguisher.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ error: 'Fire extinguisher not found' });
    await prisma.fireExtinguisher.delete({ where: { id: req.params.id } });
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'FIRE_EXTINGUISHER_DELETE',
        entity: 'FireExtinguisher',
        entityId: item.id,
        details: { rapsId: item.rapsId, unit: item.unit },
        ipAddress: req.ip,
      },
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('Delete fire extinguisher error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
