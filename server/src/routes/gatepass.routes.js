const express = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { generateSequentialNumber, paginate, applyDateFilter, isUniqueViolation, withDocRetry } = require('../utils/helpers');

const router = express.Router();

const USER_SELECT = { select: { id: true, name: true, role: true } };
const GATEPASS_INCLUDE = {
  createdBy: USER_SELECT,
  siteIncharge: USER_SELECT,
  storeIncharge: USER_SELECT,
  accountsApprover: USER_SELECT,
  finalApprover: USER_SELECT,
  items: true,
};

const PASS_TYPES = ['RETURNABLE', 'NON_RETURNABLE', 'DELIVERY_CHALLAN'];
const ALL_STATUSES = [
  'DRAFT', 'PENDING_STORE', 'PENDING_ACCOUNTS', 'PENDING_APPROVAL',
  'APPROVED', 'RETURNED', 'CLOSED', 'REJECTED', 'OPEN',
];

const toDate = (v) => (v ? new Date(v) : null);

const notify = async (data) => {
  try { await prisma.notification.create({ data }); } catch (e) { console.error('notify failed', e); }
};

// GET /api/gatepasses — list
router.get('/', authenticate, async (req, res) => {
  try {
    const { passType, status, page, limit, fromDate, toDate: toDateQ, mine } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    applyDateFilter(where, { fromDate, toDate: toDateQ });
    if (passType && PASS_TYPES.includes(passType)) where.passType = passType;
    if (status && ALL_STATUSES.includes(status)) where.status = status;
    if (mine === 'true') where.createdById = req.user.id;

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
      gatePasses,
      total,
      page: Math.ceil(skip / take) + 1,
      totalPages: Math.ceil(total / take),
    });
  } catch (error) {
    console.error('Get gate passes error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/gatepasses/:id
router.get('/:id', authenticate, async (req, res) => {
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

// POST /api/gatepasses — Manager raises the request (paper form RAMS/GPR/01)
router.post('/', authenticate, authorize('MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { siteName, remarks, items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required' });
    }
    for (const it of items) {
      if (!it.description || !it.description.trim()) {
        return res.status(400).json({ error: 'Each item requires a name/description' });
      }
      if (it.quantity == null || isNaN(Number(it.quantity)) || Number(it.quantity) <= 0) {
        return res.status(400).json({ error: 'Each item requires a positive quantity' });
      }
      if (it.itemPassType && !PASS_TYPES.includes(it.itemPassType)) {
        return res.status(400).json({ error: 'Invalid item gate pass type' });
      }
    }

    const primaryType = items.find((i) => i.itemPassType)?.itemPassType || 'RETURNABLE';

    // Derive a display "Dispatched-to" summary from the per-row entries
    const dispatchTargets = [...new Set(items.map((i) => i.dispatchedTo?.trim()).filter(Boolean))];
    const derivedPartyName = dispatchTargets.length
      ? dispatchTargets.join('; ')
      : (siteName?.trim() || 'In-house');

    let passNumber;
    const gatePass = await withDocRetry(async () => {
      passNumber = await generateSequentialNumber(prisma, 'GP');
      return prisma.gatePass.create({
        data: {
          passNumber,
          passType: primaryType,
          siteName: siteName?.trim() || null,
          partyName: derivedPartyName,
          remarks: remarks?.trim() || null,
          status: 'PENDING_STORE',
          createdById: req.user.id,
          siteInchargeById: req.user.id,
          siteInchargeAt: new Date(),
          items: {
            create: items.map((it) => ({
              description: it.description.trim(),
              quantity: Number(it.quantity),
              unit: it.unit || 'pcs',
              dispatchedTo: it.dispatchedTo?.trim() || null,
              itemPurpose: it.itemPurpose?.trim() || null,
              probableReturnDate: toDate(it.probableReturnDate),
              itemPassType: it.itemPassType || null,
              gatePassDetails: it.gatePassDetails?.trim() || null,
              transportation: it.transportation?.trim() || null,
              contactPersonDetails: it.contactPersonDetails?.trim() || null,
            })),
          },
        },
        include: GATEPASS_INCLUDE,
      });
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'CREATE',
        entity: 'GatePass',
        entityId: gatePass.id,
        details: { passNumber, partyName: gatePass.partyName },
        ipAddress: req.ip,
      },
    });

    await notify({
      type: 'GATE_PASS_REQUEST',
      title: `Gate Pass Request: ${gatePass.passNumber}`,
      message: `${req.user.name} submitted gate pass request ${gatePass.passNumber} (${items.length} item${items.length === 1 ? '' : 's'}). Awaiting Store Incharge review.`,
      targetRole: 'STORE_MANAGER',
      sentById: req.user.id,
    });

    res.status(201).json(gatePass);
  } catch (error) {
    console.error('Create gate pass error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/gatepasses/:id/store-approve — Store Incharge arranges vehicle and forwards to Accounts
router.put('/:id/store-approve', authenticate, authorize('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { driverName, vehicleNo } = req.body || {};
    if (!driverName || !driverName.trim()) {
      return res.status(400).json({ error: 'Driver name is required' });
    }
    if (!vehicleNo || !vehicleNo.trim()) {
      return res.status(400).json({ error: 'Vehicle number is required' });
    }

    const existing = await prisma.gatePass.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Gate pass not found' });
    if (existing.status !== 'PENDING_STORE') {
      return res.status(400).json({ error: 'Gate pass is not awaiting Store Incharge approval' });
    }

    const now = new Date();
    const updated = await prisma.gatePass.update({
      where: { id: req.params.id },
      data: {
        status: 'PENDING_ACCOUNTS',
        driverName: driverName.trim(),
        vehicleNo: vehicleNo.trim(),
        storeInchargeById: req.user.id,
        storeInchargeAt: now,
      },
      include: GATEPASS_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'STORE_INCHARGE_APPROVAL',
        entity: 'GatePass',
        entityId: updated.id,
        details: {
          passNumber: updated.passNumber,
          driverName: updated.driverName,
          vehicleNo: updated.vehicleNo,
          from: 'PENDING_STORE',
          to: 'PENDING_ACCOUNTS',
        },
        ipAddress: req.ip,
      },
    });

    await notify({
      type: 'GATE_PASS_STAGE',
      title: `Gate Pass ${updated.passNumber}: vehicle arranged`,
      message: `${req.user.name} arranged driver ${updated.driverName} / vehicle ${updated.vehicleNo}. Awaiting Accounts for payment.`,
      targetRole: 'ACCOUNTING',
      sentById: req.user.id,
    });

    res.json(updated);
  } catch (error) {
    console.error('Store Incharge approval error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/gatepasses/:id/accounts-approve — Accounts gives final approval (closes the workflow)
router.put('/:id/accounts-approve', authenticate, authorize('ACCOUNTING', 'ADMIN'), async (req, res) => {
  try {
    const existing = await prisma.gatePass.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Gate pass not found' });
    if (existing.status !== 'PENDING_ACCOUNTS') {
      return res.status(400).json({ error: 'Gate pass is not awaiting Accounts approval' });
    }

    const now = new Date();
    const updated = await prisma.gatePass.update({
      where: { id: req.params.id },
      data: {
        status: 'APPROVED',
        accountsById: req.user.id,
        accountsAt: now,
        approvedById: req.user.id,
        approvedAt: now,
      },
      include: GATEPASS_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'ACCOUNTS_FINAL_APPROVAL',
        entity: 'GatePass',
        entityId: updated.id,
        details: { passNumber: updated.passNumber, from: 'PENDING_ACCOUNTS', to: 'APPROVED' },
        ipAddress: req.ip,
      },
    });

    await notify({
      type: 'GATE_PASS_APPROVED',
      title: `Gate Pass Approved: ${updated.passNumber}`,
      message: `${req.user.name} (Accounts) approved the gate pass. It is now active.`,
      targetUserId: updated.createdById,
      sentById: req.user.id,
    });

    res.json(updated);
  } catch (error) {
    console.error('Accounts approval error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/gatepasses/:id/reject — any approver can reject at their stage
router.put('/:id/reject', authenticate, async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason || !reason.trim()) return res.status(400).json({ error: 'Rejection reason is required' });

    const existing = await prisma.gatePass.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Gate pass not found' });

    const stageRole = {
      PENDING_STORE: ['STORE_MANAGER', 'ADMIN'],
      PENDING_ACCOUNTS: ['ACCOUNTING', 'ADMIN'],
    }[existing.status];

    if (!stageRole) return res.status(400).json({ error: 'Gate pass cannot be rejected at this stage' });
    if (!stageRole.includes(req.user.role)) return res.status(403).json({ error: 'Not authorised to reject at this stage' });

    const updated = await prisma.gatePass.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED', rejectedReason: reason.trim() },
      include: GATEPASS_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'REJECT',
        entity: 'GatePass',
        entityId: updated.id,
        details: { passNumber: updated.passNumber, reason: reason.trim(), at: existing.status },
        ipAddress: req.ip,
      },
    });

    await notify({
      type: 'GATE_PASS_REJECTED',
      title: `Gate Pass Rejected: ${updated.passNumber}`,
      message: `${req.user.name} rejected the request. Reason: ${reason.trim()}`,
      targetUserId: updated.createdById,
      sentById: req.user.id,
    });

    res.json(updated);
  } catch (error) {
    console.error('Reject gate pass error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/gatepasses/:id/return — mark returnable items as returned
router.put('/:id/return', authenticate, authorize('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { returnedBy, actualReturnDate, remarks } = req.body;

    const existing = await prisma.gatePass.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });
    if (!existing) return res.status(404).json({ error: 'Gate pass not found' });
    if (!['APPROVED', 'OPEN'].includes(existing.status)) {
      return res.status(400).json({ error: 'Only approved gate passes can be marked as returned' });
    }

    const hasReturnable =
      existing.passType === 'RETURNABLE' ||
      existing.items.some((it) => it.itemPassType === 'RETURNABLE');
    if (!hasReturnable) {
      return res.status(400).json({ error: 'No returnable items on this gate pass' });
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

// PUT /api/gatepasses/:id/close — close the gate pass
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
