const express = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { generateSequentialNumber, withDocRetry } = require('../utils/helpers');

const router = express.Router();

const TRIP_STATUSES = ['SCHEDULED', 'IN_TRANSIT', 'RETURNED', 'CANCELLED'];

const TRIP_INCLUDE = {
  vehicle:      { select: { id: true, regNumber: true, make: true, model: true, vehicleType: true, status: true } },
  driver:       { select: { id: true, name: true, phone: true, licenseNo: true, status: true } },
  dispatchedBy: { select: { id: true, name: true, role: true } },
  returnedBy:   { select: { id: true, name: true, role: true } },
  createdBy:    { select: { id: true, name: true, role: true } },
  gatePasses:   {
    select: {
      id: true, passNumber: true, status: true, kind: true, passType: true,
      partyName: true, jobWorkNo: true, date: true,
    },
  },
};

// GET /api/vehicle-trips
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, vehicleId, driverId, q } = req.query;
    const where = {};
    if (status && TRIP_STATUSES.includes(status)) where.status = status;
    if (vehicleId) where.vehicleId = vehicleId;
    if (driverId) where.driverId = driverId;
    if (q && q.trim()) {
      const term = q.trim();
      where.OR = [
        { tripNumber:     { contains: term, mode: 'insensitive' } },
        { purpose:        { contains: term, mode: 'insensitive' } },
        { destination:    { contains: term, mode: 'insensitive' } },
        { driverNameSnap: { contains: term, mode: 'insensitive' } },
        { vehicleRegSnap: { contains: term, mode: 'insensitive' } },
      ];
    }
    const trips = await prisma.vehicleTrip.findMany({
      where,
      include: TRIP_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ trips });
  } catch (error) {
    console.error('List vehicle trips error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/vehicle-trips/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const trip = await prisma.vehicleTrip.findUnique({
      where: { id: req.params.id },
      include: TRIP_INCLUDE,
    });
    if (!trip) return res.status(404).json({ error: 'Trip not found' });
    res.json(trip);
  } catch (error) {
    console.error('Get vehicle trip error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/vehicle-trips
// Body: { vehicleId, driverId?, gatePassIds?: [], purpose?, destination?, remarks?, dispatch? }
//  - gatePassIds empty/omitted → ad-hoc trip (purpose+destination required)
//  - dispatch=true → also stamp IN_TRANSIT + flip gatepasses to IN_TRANSIT
router.post('/', authenticate, authorize('LOGISTICS', 'ADMIN'), async (req, res) => {
  try {
    const {
      vehicleId, driverId, gatePassIds, purpose, destination, remarks, dispatch,
    } = req.body || {};

    if (!vehicleId) return res.status(400).json({ error: 'vehicleId is required' });
    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) return res.status(400).json({ error: 'Vehicle not found' });
    if (vehicle.status !== 'ACTIVE') return res.status(400).json({ error: 'Vehicle is not ACTIVE' });

    let driver = null;
    if (driverId) {
      driver = await prisma.driver.findUnique({ where: { id: driverId } });
      if (!driver) return res.status(400).json({ error: 'Driver not found' });
      if (driver.status !== 'ACTIVE') return res.status(400).json({ error: 'Driver is not ACTIVE' });
    }

    const gpIds = Array.isArray(gatePassIds) ? gatePassIds.filter(Boolean) : [];
    const isAdhoc = gpIds.length === 0;

    if (isAdhoc) {
      if (!purpose?.trim() && !destination?.trim()) {
        return res.status(400).json({ error: 'Ad-hoc trips need a purpose or destination' });
      }
    } else {
      const gps = await prisma.gatePass.findMany({
        where: { id: { in: gpIds } },
        select: { id: true, status: true, kind: true, tripId: true, passNumber: true },
      });
      if (gps.length !== gpIds.length) {
        return res.status(400).json({ error: 'One or more gate passes not found' });
      }
      for (const g of gps) {
        if (!g.kind) {
          return res.status(400).json({ error: `Gate pass ${g.passNumber} is legacy and cannot be assigned to a trip` });
        }
        if (g.status !== 'PENDING_LOGISTICS') {
          return res.status(400).json({ error: `Gate pass ${g.passNumber} is not awaiting Logistics (status: ${g.status})` });
        }
        if (g.tripId) {
          return res.status(400).json({ error: `Gate pass ${g.passNumber} is already on another trip` });
        }
      }
    }

    const trip = await withDocRetry(async () => {
      const tripNumber = await generateSequentialNumber(prisma, 'TRIP');
      return prisma.$transaction(async (tx) => {
        const now = new Date();
        const created = await tx.vehicleTrip.create({
          data: {
            tripNumber,
            vehicleId: vehicle.id,
            driverId: driver?.id || null,
            vehicleRegSnap: vehicle.regNumber,
            driverNameSnap: driver?.name || null,
            driverPhoneSnap: driver?.phone || null,
            purpose: purpose?.trim() || null,
            destination: destination?.trim() || null,
            remarks: remarks?.trim() || null,
            status: dispatch ? 'IN_TRANSIT' : 'SCHEDULED',
            dispatchedAt: dispatch ? now : null,
            dispatchedById: dispatch ? req.user.id : null,
            createdById: req.user.id,
          },
        });

        if (!isAdhoc) {
          // Attach gatepasses to this trip + stamp logistics fields.
          await tx.gatePass.updateMany({
            where: { id: { in: gpIds } },
            data: {
              tripId: created.id,
              assignedVehicleId: vehicle.id,
              assignedDriverId: driver?.id || null,
              vehicleNo: vehicle.regNumber,
              driverName: driver?.name || null,
              logisticsById: req.user.id,
              logisticsAt: now,
              ...(dispatch ? { status: 'IN_TRANSIT', dispatchedAt: now } : {}),
            },
          });
        }

        return created;
      });
    });

    const full = await prisma.vehicleTrip.findUnique({
      where: { id: trip.id },
      include: TRIP_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: dispatch ? 'TRIP_CREATE_DISPATCH' : 'TRIP_CREATE',
        entity: 'VehicleTrip',
        entityId: trip.id,
        details: {
          tripNumber: trip.tripNumber,
          vehicleId, driverId: driverId || null,
          gatePassCount: gpIds.length,
          adhoc: isAdhoc,
        },
        ipAddress: req.ip,
      },
    });

    res.status(201).json(full);
  } catch (error) {
    console.error('Create vehicle trip error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/vehicle-trips/:id — edit purpose/destination/remarks while not yet returned/cancelled
router.put('/:id', authenticate, authorize('LOGISTICS', 'ADMIN'), async (req, res) => {
  try {
    const existing = await prisma.vehicleTrip.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Trip not found' });
    if (['RETURNED', 'CANCELLED'].includes(existing.status)) {
      return res.status(400).json({ error: 'Cannot edit a closed trip' });
    }
    const { purpose, destination, remarks } = req.body || {};
    const data = {};
    if (purpose !== undefined)     data.purpose     = purpose?.trim() || null;
    if (destination !== undefined) data.destination = destination?.trim() || null;
    if (remarks !== undefined)     data.remarks     = remarks?.trim() || null;

    const trip = await prisma.vehicleTrip.update({
      where: { id: req.params.id },
      data,
      include: TRIP_INCLUDE,
    });
    res.json(trip);
  } catch (error) {
    console.error('Update vehicle trip error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/vehicle-trips/:id/dispatch
router.post('/:id/dispatch', authenticate, authorize('LOGISTICS', 'ADMIN'), async (req, res) => {
  try {
    const existing = await prisma.vehicleTrip.findUnique({
      where: { id: req.params.id },
      include: { gatePasses: { select: { id: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'Trip not found' });
    if (existing.status !== 'SCHEDULED') return res.status(400).json({ error: 'Trip is not scheduled' });

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.vehicleTrip.update({
        where: { id: existing.id },
        data: {
          status: 'IN_TRANSIT',
          dispatchedAt: now,
          dispatchedById: req.user.id,
        },
      });
      if (existing.gatePasses.length) {
        await tx.gatePass.updateMany({
          where: { id: { in: existing.gatePasses.map((g) => g.id) } },
          data: { status: 'IN_TRANSIT', dispatchedAt: now },
        });
      }
    });

    const trip = await prisma.vehicleTrip.findUnique({
      where: { id: existing.id },
      include: TRIP_INCLUDE,
    });
    res.json(trip);
  } catch (error) {
    console.error('Dispatch trip error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/vehicle-trips/:id/return — mark returned (ad-hoc completion; doesn't
// auto-close gatepasses since those have their own return-ack flow).
router.post('/:id/return', authenticate, authorize('LOGISTICS', 'ADMIN'), async (req, res) => {
  try {
    const existing = await prisma.vehicleTrip.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Trip not found' });
    if (existing.status === 'RETURNED') return res.status(400).json({ error: 'Trip already returned' });
    if (existing.status === 'CANCELLED') return res.status(400).json({ error: 'Trip was cancelled' });

    const trip = await prisma.vehicleTrip.update({
      where: { id: req.params.id },
      data: {
        status: 'RETURNED',
        returnedAt: new Date(),
        returnedById: req.user.id,
      },
      include: TRIP_INCLUDE,
    });
    res.json(trip);
  } catch (error) {
    console.error('Return trip error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/vehicle-trips/:id/cancel
router.post('/:id/cancel', authenticate, authorize('LOGISTICS', 'ADMIN'), async (req, res) => {
  try {
    const existing = await prisma.vehicleTrip.findUnique({
      where: { id: req.params.id },
      include: { gatePasses: { select: { id: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'Trip not found' });
    if (existing.status !== 'SCHEDULED') return res.status(400).json({ error: 'Only scheduled trips can be cancelled' });

    await prisma.$transaction(async (tx) => {
      await tx.vehicleTrip.update({
        where: { id: existing.id },
        data: { status: 'CANCELLED' },
      });
      if (existing.gatePasses.length) {
        // Release the gatepasses so they can be re-assigned.
        await tx.gatePass.updateMany({
          where: { id: { in: existing.gatePasses.map((g) => g.id) } },
          data: {
            tripId: null,
            assignedVehicleId: null,
            assignedDriverId: null,
            vehicleNo: null,
            driverName: null,
            logisticsById: null,
            logisticsAt: null,
          },
        });
      }
    });

    const trip = await prisma.vehicleTrip.findUnique({
      where: { id: existing.id },
      include: TRIP_INCLUDE,
    });
    res.json(trip);
  } catch (error) {
    console.error('Cancel trip error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
