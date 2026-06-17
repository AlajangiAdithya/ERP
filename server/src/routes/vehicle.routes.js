const express = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');

const router = express.Router();

const VEHICLE_STATUSES = ['ACTIVE', 'INACTIVE', 'MAINTENANCE'];

// Gate-pass statuses where a vehicle is still "out" / committed on an OUTWARD job.
const ACTIVE_ASSIGN_STATUSES = ['PENDING_LOGISTICS', 'IN_TRANSIT', 'PENDING_RETURN'];

const VEHICLE_INCLUDE = {
  createdBy: { select: { id: true, name: true, role: true } },
};

const toDate = (v) => (v ? new Date(v) : null);

// GET /api/vehicles
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, q } = req.query;
    const where = {};
    if (status && VEHICLE_STATUSES.includes(status)) where.status = status;
    if (q && q.trim()) {
      const term = q.trim();
      where.OR = [
        { regNumber: { contains: term, mode: 'insensitive' } },
        { driverName: { contains: term, mode: 'insensitive' } },
        { make: { contains: term, mode: 'insensitive' } },
        { model: { contains: term, mode: 'insensitive' } },
      ];
    }
    const vehicles = await prisma.vehicle.findMany({
      where,
      include: {
        ...VEHICLE_INCLUDE,
        _count: { select: { gatePasses: true } },
        trips: {
          where: { status: 'IN_TRANSIT' },
          select: { id: true, tripNumber: true, status: true },
          take: 1,
        },
        // Gate passes this vehicle is still committed to (assigned/in-transit/awaiting
        // return). Lets the dispatch dropdown show "already assigned to GP-xxx" while
        // still allowing the same vehicle to be picked again.
        gatePasses: {
          where: { status: { in: ACTIVE_ASSIGN_STATUSES } },
          select: { id: true, passNumber: true, status: true },
          orderBy: { dispatchedAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const enriched = vehicles.map(v => ({
      ...v,
      onJob: v.trips.length > 0,
      activeTrip: v.trips[0] || null,
      activeAssignments: v.gatePasses || [],
    }));

    res.json({ vehicles: enriched });
  } catch (error) {
    console.error('List vehicles error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/vehicles/:id — full vehicle with trip history (every GatePass assigned to it)
router.get('/:id', authenticate, async (req, res) => {
  try {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: req.params.id },
      include: {
        ...VEHICLE_INCLUDE,
        trips: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: {
            driver: { select: { id: true, name: true, phone: true } },
            gatePasses: { select: { id: true, passNumber: true } },
          },
        },
        gatePasses: {
          select: {
            id: true, passNumber: true, kind: true, passType: true, direction: true,
            status: true, date: true, dispatchedAt: true, reachedDate: true,
            actualReturnDate: true, partyName: true,
            jobWorkNo: true,
          },
          orderBy: { date: 'desc' },
        },
      },
    });

    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

    const activeTrip = vehicle.trips.find(t => t.status === 'IN_TRANSIT');
    res.json({
      ...vehicle,
      onJob: !!activeTrip,
      activeTrip: activeTrip || null,
    });
  } catch (error) {
    console.error('Get vehicle error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/vehicles — create
router.post('/', authenticate, authorize('LOGISTICS', 'ADMIN'), async (req, res) => {
  try {
    const {
      regNumber, vehicleType, make, model, capacityKg, ownerType,
      driverName, driverPhone, insuranceExpiry, pucExpiry, fitnessExpiry,
      rcUrl, status, notes,
    } = req.body || {};

    if (!regNumber?.trim()) return res.status(400).json({ error: 'Registration number is required' });
    const normalized = regNumber.trim().toUpperCase();

    const exists = await prisma.vehicle.findUnique({ where: { regNumber: normalized } });
    if (exists) return res.status(400).json({ error: 'A vehicle with this registration number already exists' });

    const vehicle = await prisma.vehicle.create({
      data: {
        regNumber: normalized,
        vehicleType: vehicleType?.trim() || null,
        make: make?.trim() || null,
        model: model?.trim() || null,
        capacityKg: capacityKg != null && capacityKg !== '' ? Number(capacityKg) : null,
        ownerType: ownerType?.trim() || null,
        driverName: driverName?.trim() || null,
        driverPhone: driverPhone?.trim() || null,
        insuranceExpiry: toDate(insuranceExpiry),
        pucExpiry: toDate(pucExpiry),
        fitnessExpiry: toDate(fitnessExpiry),
        rcUrl: rcUrl?.trim() || null,
        status: VEHICLE_STATUSES.includes(status) ? status : 'ACTIVE',
        notes: notes?.trim() || null,
        createdById: req.user.id,
      },
      include: VEHICLE_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'VEHICLE_CREATE',
        entity: 'Vehicle',
        entityId: vehicle.id,
        details: { regNumber: vehicle.regNumber },
        ipAddress: req.ip,
      },
    });

    res.status(201).json(vehicle);
  } catch (error) {
    console.error('Create vehicle error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/vehicles/:id — update
router.put('/:id', authenticate, authorize('LOGISTICS', 'ADMIN'), async (req, res) => {
  try {
    const existing = await prisma.vehicle.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Vehicle not found' });

    const {
      regNumber, vehicleType, make, model, capacityKg, ownerType,
      driverName, driverPhone, insuranceExpiry, pucExpiry, fitnessExpiry,
      rcUrl, status, notes,
    } = req.body || {};

    const data = {};
    if (regNumber !== undefined) {
      const normalized = regNumber?.trim()?.toUpperCase();
      if (!normalized) return res.status(400).json({ error: 'Registration number cannot be empty' });
      if (normalized !== existing.regNumber) {
        const clash = await prisma.vehicle.findUnique({ where: { regNumber: normalized } });
        if (clash) return res.status(400).json({ error: 'Another vehicle already has this registration number' });
      }
      data.regNumber = normalized;
    }
    if (vehicleType !== undefined) data.vehicleType = vehicleType?.trim() || null;
    if (make !== undefined) data.make = make?.trim() || null;
    if (model !== undefined) data.model = model?.trim() || null;
    if (capacityKg !== undefined) data.capacityKg = capacityKg != null && capacityKg !== '' ? Number(capacityKg) : null;
    if (ownerType !== undefined) data.ownerType = ownerType?.trim() || null;
    if (driverName !== undefined) data.driverName = driverName?.trim() || null;
    if (driverPhone !== undefined) data.driverPhone = driverPhone?.trim() || null;
    if (insuranceExpiry !== undefined) data.insuranceExpiry = toDate(insuranceExpiry);
    if (pucExpiry !== undefined) data.pucExpiry = toDate(pucExpiry);
    if (fitnessExpiry !== undefined) data.fitnessExpiry = toDate(fitnessExpiry);
    if (rcUrl !== undefined) data.rcUrl = rcUrl?.trim() || null;
    if (status !== undefined && VEHICLE_STATUSES.includes(status)) data.status = status;
    if (notes !== undefined) data.notes = notes?.trim() || null;

    const vehicle = await prisma.vehicle.update({
      where: { id: req.params.id },
      data,
      include: VEHICLE_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'VEHICLE_UPDATE',
        entity: 'Vehicle',
        entityId: vehicle.id,
        details: { regNumber: vehicle.regNumber, changes: Object.keys(data) },
        ipAddress: req.ip,
      },
    });

    res.json(vehicle);
  } catch (error) {
    console.error('Update vehicle error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/vehicles/:id — only if no trips
router.delete('/:id', authenticate, authorize('LOGISTICS', 'ADMIN'), async (req, res) => {
  try {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { gatePasses: true } } },
    });
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    if (vehicle._count.gatePasses > 0) {
      return res.status(400).json({ error: 'Cannot delete a vehicle with assigned gate passes. Set status to INACTIVE instead.' });
    }
    await prisma.vehicle.delete({ where: { id: req.params.id } });
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'VEHICLE_DELETE',
        entity: 'Vehicle',
        entityId: vehicle.id,
        details: { regNumber: vehicle.regNumber },
        ipAddress: req.ip,
      },
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('Delete vehicle error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
