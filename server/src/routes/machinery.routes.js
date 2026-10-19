// ──────────────────────────────────────────────────────────────
// Machinery + Fire Extinguisher register
//
// Access model:
//   • Full edit: SAFETY (department owner) and any user whose unit is Unit-5.
//                (SUPERADMIN bypasses every authorize() check globally.)
//   • View-only: every other authenticated user.
// Server gates writes; the UI hides controls based on the same rules.
// ──────────────────────────────────────────────────────────────
const express = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { amcDocUpload, publicUrlFor } = require('../middleware/upload');

const router = express.Router();

// Unit 5 may appear as code '5', name 'Unit 5', or username 'unit 5' depending
// on which path created the account - match any of them (mirrors the metrology
// register's Unit-5 detection).
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

// `place` is the free-text label people type ("Unit-5", "Unit-2 QC Lab",
// "Unit-1 (NDT)"). Work-status edit rights are scoped to a manager's own unit,
// so the owning Unit has to be resolved to a real id at write time - matching
// the free text on every request would be guesswork. A place that matches no
// unit resolves to null and the machine shows under Unassigned, which is
// visible rather than silently mis-filed.
// Unit.code is not spelled the same everywhere - production stores 'UNIT-1' /
// 'UNIT-1A', the dev seed stores bare '1' / '1A' - so both sides are stripped
// of punctuation and either spelling is accepted. Comparing the raw token to
// the raw code matches nothing on production and quietly files every machine
// as Unassigned.
const resolveUnitId = async (place) => {
  if (!place) return null;
  const m = /^[Uu]nit[-\s]*([0-9]+[A-Za-z]?)/.exec(String(place).trim());
  if (!m) return null;
  const token = m[1].toUpperCase();
  const units = await prisma.unit.findMany({ select: { id: true, code: true } });
  const norm = (c) => (c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const hit = units.find((u) => norm(u.code) === `UNIT${token}` || norm(u.code) === token);
  return hit?.id ?? null;
};

// Lightweight permissions probe used by the client to decide whether to render
// add/edit/delete buttons. Mirrors canWrite exactly.
router.get('/permissions', authenticate, (req, res) => {
  res.json({ canWrite: canWrite(req.user) });
});

// ───────────────────── Machinery ─────────────────────

// GET /api/machinery
router.get('/', authenticate, async (req, res) => {
  try {
    const items = await prisma.machinery.findMany({
      orderBy: [{ serialNumber: 'asc' }, { createdAt: 'asc' }],
    });
    res.json({ items, canWrite: canWrite(req.user) });
  } catch (error) {
    console.error('List machinery error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/machinery
router.post('/', authenticate, requireWrite, async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.name?.trim()) return res.status(400).json({ error: 'Name is required' });
    if (!body.rapsId?.trim()) return res.status(400).json({ error: 'RAPS ID is required' });

    const rapsId = body.rapsId.trim();
    const clash = await prisma.machinery.findUnique({ where: { rapsId } });
    if (clash) return res.status(400).json({ error: 'A machine with this RAPS ID already exists' });

    // Auto-assign next serial number if not provided.
    let serialNumber = parseInt(body.serialNumber, 10);
    if (!Number.isFinite(serialNumber) || serialNumber <= 0) {
      const last = await prisma.machinery.findFirst({ orderBy: { serialNumber: 'desc' } });
      serialNumber = (last?.serialNumber || 0) + 1;
    }

    const place = trimOrNull(body.place) ?? null;

    const item = await prisma.machinery.create({
      data: {
        serialNumber,
        name: body.name.trim(),
        capacity: trimOrNull(body.capacity) ?? null,
        makeModel: trimOrNull(body.makeModel) ?? null,
        machineSerialNo: trimOrNull(body.machineSerialNo) ?? null,
        rapsId,
        place,
        unitId: await resolveUnitId(place),
        remarks: trimOrNull(body.remarks) ?? null,
        amcStatus: trimOrNull(body.amcStatus) ?? null,
        amcVendor: trimOrNull(body.amcVendor) ?? null,
        amcExpiry: toDate(body.amcExpiry),
        createdById: req.user.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'MACHINERY_CREATE',
        entity: 'Machinery',
        entityId: item.id,
        details: { name: item.name, rapsId: item.rapsId },
        ipAddress: req.ip,
      },
    });

    res.status(201).json(item);
  } catch (error) {
    console.error('Create machinery error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/machinery/:id
router.put('/:id', authenticate, requireWrite, async (req, res) => {
  try {
    const existing = await prisma.machinery.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Machine not found' });

    const body = req.body || {};
    const data = {};

    if (body.serialNumber !== undefined) {
      const n = parseInt(body.serialNumber, 10);
      if (Number.isFinite(n) && n > 0) data.serialNumber = n;
    }
    if (body.name !== undefined) {
      if (!body.name?.trim()) return res.status(400).json({ error: 'Name cannot be empty' });
      data.name = body.name.trim();
    }
    if (body.rapsId !== undefined) {
      const rapsId = body.rapsId?.trim();
      if (!rapsId) return res.status(400).json({ error: 'RAPS ID cannot be empty' });
      if (rapsId !== existing.rapsId) {
        const clash = await prisma.machinery.findUnique({ where: { rapsId } });
        if (clash) return res.status(400).json({ error: 'Another machine already has this RAPS ID' });
      }
      data.rapsId = rapsId;
    }
    ['capacity', 'makeModel', 'machineSerialNo', 'place', 'remarks', 'amcStatus', 'amcVendor']
      .forEach((k) => { if (body[k] !== undefined) data[k] = trimOrNull(body[k]) ?? null; });
    // Moving a machine between units has to move who may log work on it, so
    // re-resolve the unit whenever `place` is edited.
    if (body.place !== undefined) data.unitId = await resolveUnitId(data.place);
    if (body.amcExpiry !== undefined) data.amcExpiry = toDate(body.amcExpiry);
    // amcAttachment is set via the dedicated upload route, but allow clearing it.
    if (body.amcAttachment === null || body.amcAttachment === '') data.amcAttachment = null;

    const item = await prisma.machinery.update({ where: { id: req.params.id }, data });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'MACHINERY_UPDATE',
        entity: 'Machinery',
        entityId: item.id,
        details: { name: item.name, changes: Object.keys(data) },
        ipAddress: req.ip,
      },
    });

    res.json(item);
  } catch (error) {
    console.error('Update machinery error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/machinery/:id/amc-document
router.post(
  '/:id/amc-document',
  authenticate,
  requireWrite,
  amcDocUpload.single('document'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Document is required (PDF/PNG/JPG)' });
      const url = publicUrlFor('amc-docs', req.file.filename);
      const item = await prisma.machinery.update({
        where: { id: req.params.id },
        data: { amcAttachment: url },
      });
      res.json(item);
    } catch (error) {
      console.error('Upload AMC doc error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// DELETE /api/machinery/:id
router.delete('/:id', authenticate, requireWrite, async (req, res) => {
  try {
    const item = await prisma.machinery.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ error: 'Machine not found' });
    await prisma.machinery.delete({ where: { id: req.params.id } });
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'MACHINERY_DELETE',
        entity: 'Machinery',
        entityId: item.id,
        details: { name: item.name, rapsId: item.rapsId },
        ipAddress: req.ip,
      },
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('Delete machinery error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
