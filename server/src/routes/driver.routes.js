const express = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');

const router = express.Router();

const DRIVER_STATUSES = ['ACTIVE', 'INACTIVE'];

const DRIVER_INCLUDE = {
  createdBy:      { select: { id: true, name: true, role: true } },
  defaultVehicle: { select: { id: true, regNumber: true, make: true, model: true } },
};

const toDate = (v) => (v ? new Date(v) : null);

// GET /api/drivers
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, q } = req.query;
    const where = {};
    if (status && DRIVER_STATUSES.includes(status)) where.status = status;
    if (q && q.trim()) {
      const term = q.trim();
      where.OR = [
        { name:      { contains: term, mode: 'insensitive' } },
        { phone:     { contains: term, mode: 'insensitive' } },
        { licenseNo: { contains: term, mode: 'insensitive' } },
      ];
    }
    const drivers = await prisma.driver.findMany({
      where,
      include: {
        ...DRIVER_INCLUDE,
        _count: { select: { gatePasses: true, trips: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ drivers });
  } catch (error) {
    console.error('List drivers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/drivers/:id — driver + previous movement history.
// History = every VehicleTrip + every legacy GatePass directly assigned to the
// driver (older flows didn't go through trips).
router.get('/:id', authenticate, async (req, res) => {
  try {
    const driver = await prisma.driver.findUnique({
      where: { id: req.params.id },
      include: {
        ...DRIVER_INCLUDE,
        trips: {
          select: {
            id: true, tripNumber: true, status: true,
            vehicle: { select: { id: true, regNumber: true } },
            vehicleRegSnap: true,
            purpose: true, destination: true,
            dispatchedAt: true, returnedAt: true,
            createdAt: true,
            gatePasses: {
              select: { id: true, passNumber: true, kind: true, partyName: true, status: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        gatePasses: {
          select: {
            id: true, passNumber: true, kind: true, passType: true, direction: true,
            status: true, date: true, dispatchedAt: true, reachedDate: true,
            actualReturnDate: true, partyName: true, jobWorkNo: true,
            assignedVehicle: { select: { id: true, regNumber: true } },
          },
          orderBy: { date: 'desc' },
        },
      },
    });
    if (!driver) return res.status(404).json({ error: 'Driver not found' });
    res.json(driver);
  } catch (error) {
    console.error('Get driver error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/drivers — create
router.post('/', authenticate, authorize('LOGISTICS', 'ADMIN'), async (req, res) => {
  try {
    const {
      name, phone, licenseNo, licenseExpiry, defaultVehicleId, status, notes,
    } = req.body || {};

    if (!name?.trim()) return res.status(400).json({ error: 'Driver name is required' });
    const normalizedLicense = licenseNo?.trim()?.toUpperCase() || null;
    if (normalizedLicense) {
      const clash = await prisma.driver.findUnique({ where: { licenseNo: normalizedLicense } });
      if (clash) return res.status(400).json({ error: 'A driver with this license number already exists' });
    }
    if (defaultVehicleId) {
      const v = await prisma.vehicle.findUnique({ where: { id: defaultVehicleId } });
      if (!v) return res.status(400).json({ error: 'Default vehicle not found' });
    }

    const driver = await prisma.driver.create({
      data: {
        name: name.trim(),
        phone: phone?.trim() || null,
        licenseNo: normalizedLicense,
        licenseExpiry: toDate(licenseExpiry),
        defaultVehicleId: defaultVehicleId || null,
        status: DRIVER_STATUSES.includes(status) ? status : 'ACTIVE',
        notes: notes?.trim() || null,
        createdById: req.user.id,
      },
      include: DRIVER_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'DRIVER_CREATE',
        entity: 'Driver',
        entityId: driver.id,
        details: { name: driver.name, licenseNo: driver.licenseNo },
        ipAddress: req.ip,
      },
    });

    res.status(201).json(driver);
  } catch (error) {
    console.error('Create driver error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/drivers/:id
router.put('/:id', authenticate, authorize('LOGISTICS', 'ADMIN'), async (req, res) => {
  try {
    const existing = await prisma.driver.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Driver not found' });

    const {
      name, phone, licenseNo, licenseExpiry, defaultVehicleId, status, notes,
    } = req.body || {};

    const data = {};
    if (name !== undefined) {
      if (!name?.trim()) return res.status(400).json({ error: 'Name cannot be empty' });
      data.name = name.trim();
    }
    if (phone !== undefined) data.phone = phone?.trim() || null;
    if (licenseNo !== undefined) {
      const norm = licenseNo?.trim()?.toUpperCase() || null;
      if (norm && norm !== existing.licenseNo) {
        const clash = await prisma.driver.findUnique({ where: { licenseNo: norm } });
        if (clash) return res.status(400).json({ error: 'Another driver already has this license number' });
      }
      data.licenseNo = norm;
    }
    if (licenseExpiry !== undefined) data.licenseExpiry = toDate(licenseExpiry);
    if (defaultVehicleId !== undefined) {
      if (defaultVehicleId) {
        const v = await prisma.vehicle.findUnique({ where: { id: defaultVehicleId } });
        if (!v) return res.status(400).json({ error: 'Default vehicle not found' });
      }
      data.defaultVehicleId = defaultVehicleId || null;
    }
    if (status !== undefined && DRIVER_STATUSES.includes(status)) data.status = status;
    if (notes !== undefined) data.notes = notes?.trim() || null;

    const driver = await prisma.driver.update({
      where: { id: req.params.id },
      data,
      include: DRIVER_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'DRIVER_UPDATE',
        entity: 'Driver',
        entityId: driver.id,
        details: { name: driver.name, changes: Object.keys(data) },
        ipAddress: req.ip,
      },
    });

    res.json(driver);
  } catch (error) {
    console.error('Update driver error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/drivers/:id — only if no trips or gatepasses reference them.
router.delete('/:id', authenticate, authorize('LOGISTICS', 'ADMIN'), async (req, res) => {
  try {
    const driver = await prisma.driver.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { trips: true, gatePasses: true } } },
    });
    if (!driver) return res.status(404).json({ error: 'Driver not found' });
    if (driver._count.trips > 0 || driver._count.gatePasses > 0) {
      return res.status(400).json({ error: 'Cannot delete a driver with trip/gatepass history. Set status to INACTIVE instead.' });
    }
    await prisma.driver.delete({ where: { id: req.params.id } });
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'DRIVER_DELETE',
        entity: 'Driver',
        entityId: driver.id,
        details: { name: driver.name },
        ipAddress: req.ip,
      },
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('Delete driver error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
