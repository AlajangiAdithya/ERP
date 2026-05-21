// ──────────────────────────────────────────────────────────────
// Tender — TENDER_MANAGER assigns tenders to a unit's MANAGER.
// MANAGER updates progress (IN_PROGRESS → SUBMITTED → WON/LOST).
// SAFETY + ADMIN: read-only monitor.
// ──────────────────────────────────────────────────────────────
const express = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { generateSequentialNumber, paginate, applyDateFilter } = require('../utils/helpers');

const router = express.Router();

const TENDER_VIEW_ROLES = ['TENDER_MANAGER', 'ADMIN', 'MANAGER', 'SAFETY'];
const TENDER_STATUSES = ['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'WON', 'LOST', 'CANCELLED'];

const TENDER_INCLUDE = {
  unit:       { select: { id: true, name: true, code: true } },
  createdBy:  { select: { id: true, name: true, role: true } },
  assignedTo: { select: { id: true, name: true, role: true, unit: { select: { id: true, name: true, code: true } } } },
};

// GET /api/tenders — list
router.get('/', authenticate, authorize(...TENDER_VIEW_ROLES), async (req, res) => {
  try {
    const { status, page, limit, fromDate, toDate } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    applyDateFilter(where, { fromDate, toDate });
    if (status && TENDER_STATUSES.includes(status)) where.status = status;

    // MANAGER sees tenders assigned to them or to their unit
    if (req.user.role === 'MANAGER') {
      where.OR = [
        { assignedToId: req.user.id },
        { unitId: req.user.unitId },
      ];
    }
    // TENDER_MANAGER, ADMIN, SAFETY: see all

    const [tenders, total] = await Promise.all([
      prisma.tender.findMany({
        where,
        include: TENDER_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.tender.count({ where }),
    ]);

    res.json({
      tenders,
      total,
      page: Math.ceil(skip / take) + 1,
      totalPages: Math.ceil(total / take),
    });
  } catch (error) {
    console.error('List tender error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/tenders/:id
router.get('/:id', authenticate, authorize(...TENDER_VIEW_ROLES), async (req, res) => {
  try {
    const tender = await prisma.tender.findUnique({
      where: { id: req.params.id },
      include: TENDER_INCLUDE,
    });
    if (!tender) return res.status(404).json({ error: 'Tender not found' });

    if (req.user.role === 'MANAGER') {
      const isAssignee = tender.assignedToId === req.user.id;
      const isInUnit = tender.unitId === req.user.unitId;
      if (!isAssignee && !isInUnit) return res.status(403).json({ error: 'Not your tender' });
    }
    res.json(tender);
  } catch (error) {
    console.error('Get tender error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/tenders — TENDER_MANAGER creates and assigns to a unit / manager
router.post('/', authenticate, authorize('TENDER_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const {
      title, description, clientName, estimatedValue,
      submissionDate, notes, unitId, assignedToId,
    } = req.body;

    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'Tender title is required' });
    }
    if (!unitId) {
      return res.status(400).json({ error: 'Unit is required' });
    }

    const unit = await prisma.unit.findUnique({ where: { id: unitId } });
    if (!unit) return res.status(400).json({ error: 'Unit not found' });

    let resolvedAssigneeId = null;
    if (assignedToId) {
      const target = await prisma.user.findUnique({
        where: { id: assignedToId },
        select: { id: true, role: true, isActive: true, unitId: true },
      });
      if (!target || !target.isActive || target.role !== 'MANAGER') {
        return res.status(400).json({ error: 'Selected assignee is not an active manager' });
      }
      if (target.unitId !== unitId) {
        return res.status(400).json({ error: 'Selected manager does not belong to the chosen unit' });
      }
      resolvedAssigneeId = target.id;
    }

    const tenderNumber = await generateSequentialNumber(prisma, 'TND');

    const tender = await prisma.tender.create({
      data: {
        tenderNumber,
        title: String(title).trim(),
        description: description || null,
        clientName: clientName || null,
        estimatedValue: estimatedValue != null ? Number(estimatedValue) : null,
        submissionDate: submissionDate ? new Date(submissionDate) : null,
        notes: notes || null,
        status: 'ASSIGNED',
        unitId,
        createdById: req.user.id,
        assignedToId: resolvedAssigneeId,
      },
      include: TENDER_INCLUDE,
    });

    if (resolvedAssigneeId) {
      await prisma.notification.create({
        data: {
          type: 'TENDER_ASSIGNED',
          title: `New Tender: ${tender.tenderNumber}`,
          message: `${req.user.name} assigned tender "${tender.title}" to your unit. Please review and start work.`,
          targetUserId: resolvedAssigneeId,
          sentById: req.user.id,
        },
      });
    } else {
      await prisma.notification.create({
        data: {
          type: 'TENDER_ASSIGNED',
          title: `New Tender: ${tender.tenderNumber}`,
          message: `A new tender "${tender.title}" has been assigned to your unit (${unit.name}).`,
          targetRole: 'MANAGER',
          sentById: req.user.id,
        },
      });
    }

    res.status(201).json(tender);
  } catch (error) {
    console.error('Create tender error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/tenders/:id/status — MANAGER (assignee) progresses; TENDER_MANAGER/ADMIN can cancel
router.put('/:id/status', authenticate, authorize('MANAGER', 'TENDER_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { status, notes } = req.body;
    if (!TENDER_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid tender status' });
    }

    const existing = await prisma.tender.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Tender not found' });

    if (req.user.role === 'MANAGER') {
      if (existing.assignedToId !== req.user.id) {
        return res.status(403).json({ error: 'Only the assigned manager can update this tender' });
      }
      if (!['IN_PROGRESS', 'SUBMITTED', 'WON', 'LOST'].includes(status)) {
        return res.status(400).json({ error: 'Manager cannot move tender to this status' });
      }
    }

    const updated = await prisma.tender.update({
      where: { id: req.params.id },
      data: {
        status,
        notes: notes != null ? notes : existing.notes,
      },
      include: TENDER_INCLUDE,
    });

    if (existing.createdById && existing.createdById !== req.user.id) {
      await prisma.notification.create({
        data: {
          type: 'TENDER_STATUS_UPDATE',
          title: `Tender ${updated.tenderNumber}: ${status}`,
          message: `${req.user.name} updated tender "${updated.title}" to ${status}.`,
          targetUserId: existing.createdById,
          sentById: req.user.id,
        },
      });
    }

    res.json(updated);
  } catch (error) {
    console.error('Update tender status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
