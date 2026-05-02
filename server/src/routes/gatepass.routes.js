const express = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { generateOrderNumber, paginate } = require('../utils/helpers');

const router = express.Router();

const GATEPASS_INCLUDE = {
  createdBy: { select: { id: true, name: true, role: true } },
  items: true,
};

const PASS_TYPES = ['RETURNABLE', 'NON_RETURNABLE', 'DELIVERY_CHALLAN'];

// GET /api/gatepasses — list
router.get('/', authenticate, authorize('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { passType, status, page, limit } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    if (passType && PASS_TYPES.includes(passType)) where.passType = passType;
    if (status && ['OPEN', 'RETURNED', 'CLOSED'].includes(status)) where.status = status;

    const [gatePasses, total] = await Promise.all([
      prisma.gatePass.findMany({
        where,
        include: GATEPASS_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.gatePass.count({ where }),
    ]);

    res.json({
      gatePasses, total,
      page: Math.ceil(skip / take) + 1,
      totalPages: Math.ceil(total / take),
    });
  } catch (error) {
    console.error('Get gate passes error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/gatepasses/:id
router.get('/:id', authenticate, authorize('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const gatePass = await prisma.gatePass.findUnique({
      where: { id: req.params.id },
      include: GATEPASS_INCLUDE,
    });
    if (!gatePass) return res.status(404).json({ error: 'Gate pass not found' });
    res.json(gatePass);
  } catch (error) {
    console.error('Get gate pass error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/gatepasses — create
router.post('/', authenticate, authorize('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const {
      passType, partyName, partyContact, vehicleNo, invoiceNo, dcNo,
      purpose, expectedReturnDate, issuedToName, issuedToDept,
      requisitionNo, remarks, items,
    } = req.body;

    if (!passType || !PASS_TYPES.includes(passType)) {
      return res.status(400).json({ error: 'Pass type must be RETURNABLE, NON_RETURNABLE, or DELIVERY_CHALLAN' });
    }
    if (!partyName || !partyName.trim()) {
      return res.status(400).json({ error: 'Party (Vendor/Customer) name is required' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required' });
    }
    for (const it of items) {
      if (!it.description || !it.description.trim()) {
        return res.status(400).json({ error: 'Each item requires a description' });
      }
      if (it.quantity == null || isNaN(Number(it.quantity)) || Number(it.quantity) <= 0) {
        return res.status(400).json({ error: 'Each item requires a positive quantity' });
      }
    }

    const prefix = passType === 'RETURNABLE' ? 'GP-R' : passType === 'NON_RETURNABLE' ? 'GP-NR' : 'DC';
    const passNumber = generateOrderNumber(prefix);

    const gatePass = await prisma.gatePass.create({
      data: {
        passNumber,
        passType,
        partyName: partyName.trim(),
        partyContact: partyContact || null,
        vehicleNo: vehicleNo || null,
        invoiceNo: invoiceNo || null,
        dcNo: dcNo || null,
        purpose: purpose || null,
        expectedReturnDate: expectedReturnDate ? new Date(expectedReturnDate) : null,
        issuedToName: issuedToName || null,
        issuedToDept: issuedToDept || null,
        requisitionNo: requisitionNo || null,
        remarks: remarks || null,
        status: 'OPEN',
        createdById: req.user.id,
        items: {
          create: items.map((it) => ({
            description: it.description.trim(),
            quantity: Number(it.quantity),
            unit: it.unit || 'pcs',
            remarks: it.remarks || null,
          })),
        },
      },
      include: GATEPASS_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'CREATE',
        entity: 'GatePass',
        entityId: gatePass.id,
        details: { passNumber, passType, partyName: gatePass.partyName },
        ipAddress: req.ip,
      },
    });

    res.status(201).json(gatePass);
  } catch (error) {
    console.error('Create gate pass error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/gatepasses/:id/return — mark as returned (RETURNABLE only)
router.put('/:id/return', authenticate, authorize('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { returnedBy, actualReturnDate, remarks } = req.body;

    const existing = await prisma.gatePass.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Gate pass not found' });
    if (existing.passType !== 'RETURNABLE') {
      return res.status(400).json({ error: 'Only returnable gate passes can be marked as returned' });
    }
    if (existing.status !== 'OPEN') {
      return res.status(400).json({ error: 'Gate pass is not open' });
    }

    const updated = await prisma.gatePass.update({
      where: { id: req.params.id },
      data: {
        status: 'RETURNED',
        returnedBy: returnedBy || req.user.name,
        actualReturnDate: actualReturnDate ? new Date(actualReturnDate) : new Date(),
        remarks: remarks != null ? remarks : existing.remarks,
      },
      include: GATEPASS_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'RETURN',
        entity: 'GatePass',
        entityId: updated.id,
        details: { passNumber: updated.passNumber },
        ipAddress: req.ip,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Return gate pass error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/gatepasses/:id/close — mark as closed
router.put('/:id/close', authenticate, authorize('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { remarks } = req.body;

    const existing = await prisma.gatePass.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Gate pass not found' });
    if (existing.status === 'CLOSED') {
      return res.status(400).json({ error: 'Gate pass is already closed' });
    }

    const updated = await prisma.gatePass.update({
      where: { id: req.params.id },
      data: {
        status: 'CLOSED',
        remarks: remarks != null ? remarks : existing.remarks,
      },
      include: GATEPASS_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'CLOSE',
        entity: 'GatePass',
        entityId: updated.id,
        details: { passNumber: updated.passNumber },
        ipAddress: req.ip,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Close gate pass error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
