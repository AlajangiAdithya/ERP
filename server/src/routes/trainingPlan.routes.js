// ──────────────────────────────────────────────────────────────
// Annual Training Plan (per fiscal year)
//
// Access:
//   • HR + ADMIN + SUPERADMIN: full edit of plan + every item
//   • MANAGER: can add / edit / delete items they created or items tagged to
//     their own unit. Cannot create or archive plans.
//   • Everyone else auth'd: view
// ──────────────────────────────────────────────────────────────
const express = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const PLAN_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'];
const ITEM_STATUSES = ['PLANNED', 'SCHEDULED', 'COMPLETED', 'CANCELLED'];

const isHr        = (u) => !!u && (u.role === 'HR' || u.role === 'ADMIN' || u.role === 'SUPERADMIN');
const isManager   = (u) => !!u && u.role === 'MANAGER';
const canEditPlan = (u) => isHr(u);

const canEditItem = (u, item) => {
  if (isHr(u)) return true;
  if (isManager(u)) {
    // Managers can edit items they created OR items tagged to their unit.
    if (item.createdById === u.id) return true;
    if (item.unitId && item.unitId === u.unitId) return true;
  }
  return false;
};

const trimOrNull = (v) => {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === '' ? null : s;
};

router.get('/permissions', authenticate, (req, res) => {
  res.json({
    canEditPlan: canEditPlan(req.user),
    canAddItems: isHr(req.user) || isManager(req.user),
  });
});

// GET /api/training-plans
router.get('/', authenticate, async (req, res) => {
  try {
    const { status } = req.query;
    const where = {};
    if (status && PLAN_STATUSES.includes(status)) where.status = status;
    const plans = await prisma.trainingPlan.findMany({
      where,
      include: {
        createdBy: { select: { id: true, name: true } },
        _count:    { select: { items: true, sessions: true } },
      },
      orderBy: { fiscalYear: 'desc' },
    });
    res.json({ plans });
  } catch (e) {
    console.error('List plans:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const plan = await prisma.trainingPlan.findUnique({
      where: { id: req.params.id },
      include: {
        createdBy: { select: { id: true, name: true } },
        items: {
          orderBy: { serialNo: 'asc' },
          include: {
            createdBy: { select: { id: true, name: true, role: true } },
            unit:      { select: { id: true, name: true, code: true } },
            _count:    { select: { sessions: true } },
          },
        },
      },
    });
    if (!plan) return res.status(404).json({ error: 'Training plan not found' });
    res.json({
      ...plan,
      canEditPlan:  canEditPlan(req.user),
      canAddItems:  isHr(req.user) || isManager(req.user),
    });
  } catch (e) {
    console.error('Get plan:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/training-plans
router.post('/', authenticate, async (req, res) => {
  if (!canEditPlan(req.user)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const { fiscalYear, title, reference, preparedBy, approvedBy, status } = req.body || {};
    if (!fiscalYear?.trim()) return res.status(400).json({ error: 'Fiscal year is required' });
    if (!title?.trim())      return res.status(400).json({ error: 'Title is required' });
    const fy = fiscalYear.trim();
    const clash = await prisma.trainingPlan.findUnique({ where: { fiscalYear: fy } });
    if (clash) return res.status(400).json({ error: 'A plan for this fiscal year already exists' });

    const plan = await prisma.trainingPlan.create({
      data: {
        fiscalYear: fy,
        title: title.trim(),
        reference:  trimOrNull(reference),
        preparedBy: trimOrNull(preparedBy),
        approvedBy: trimOrNull(approvedBy),
        status: PLAN_STATUSES.includes(status) ? status : 'DRAFT',
        createdById: req.user.id,
      },
    });
    res.status(201).json(plan);
  } catch (e) {
    console.error('Create plan:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', authenticate, async (req, res) => {
  if (!canEditPlan(req.user)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const plan = await prisma.trainingPlan.findUnique({ where: { id: req.params.id } });
    if (!plan) return res.status(404).json({ error: 'Training plan not found' });
    const { fiscalYear, title, reference, preparedBy, approvedBy, status } = req.body || {};
    const data = {};
    if (fiscalYear !== undefined) {
      const fy = fiscalYear.trim();
      if (!fy) return res.status(400).json({ error: 'Fiscal year cannot be empty' });
      if (fy !== plan.fiscalYear) {
        const clash = await prisma.trainingPlan.findUnique({ where: { fiscalYear: fy } });
        if (clash) return res.status(400).json({ error: 'Another plan already uses this fiscal year' });
      }
      data.fiscalYear = fy;
    }
    if (title !== undefined) {
      if (!title?.trim()) return res.status(400).json({ error: 'Title cannot be empty' });
      data.title = title.trim();
    }
    if (reference  !== undefined) data.reference  = trimOrNull(reference);
    if (preparedBy !== undefined) data.preparedBy = trimOrNull(preparedBy);
    if (approvedBy !== undefined) data.approvedBy = trimOrNull(approvedBy);
    if (status !== undefined) {
      if (!PLAN_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
      data.status = status;
    }
    const updated = await prisma.trainingPlan.update({ where: { id: plan.id }, data });
    res.json(updated);
  } catch (e) {
    console.error('Update plan:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', authenticate, async (req, res) => {
  if (!canEditPlan(req.user)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const plan = await prisma.trainingPlan.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { items: true, sessions: true } } },
    });
    if (!plan) return res.status(404).json({ error: 'Training plan not found' });
    if (plan._count.sessions > 0) {
      return res.status(400).json({ error: 'Cannot delete a plan with linked sessions. Archive it instead.' });
    }
    await prisma.trainingPlan.delete({ where: { id: plan.id } });
    res.json({ ok: true });
  } catch (e) {
    console.error('Delete plan:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Items ──

// POST /api/training-plans/:id/items — HR or any Manager (for their unit).
router.post('/:id/items', authenticate, async (req, res) => {
  if (!isHr(req.user) && !isManager(req.user)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const plan = await prisma.trainingPlan.findUnique({ where: { id: req.params.id } });
    if (!plan) return res.status(404).json({ error: 'Training plan not found' });

    const {
      subject, participants, faculty, scheduledMonth, actualMonth,
      hoursPerMonth, remarks, status, unitId, category,
    } = req.body || {};
    if (!subject?.trim())      return res.status(400).json({ error: 'Subject is required' });
    if (!participants?.trim()) return res.status(400).json({ error: 'Participants is required' });

    // Managers can only file an item for their OWN unit (or leave unit blank).
    let resolvedUnitId = unitId || null;
    if (isManager(req.user) && !isHr(req.user)) {
      if (resolvedUnitId && resolvedUnitId !== req.user.unitId) {
        return res.status(403).json({ error: 'Managers can only add items for their own unit' });
      }
      if (!resolvedUnitId) resolvedUnitId = req.user.unitId || null;
    }

    const top = await prisma.trainingPlanItem.aggregate({
      where: { planId: plan.id },
      _max: { serialNo: true },
    });
    const nextSerial = (top._max.serialNo || 0) + 1;

    const item = await prisma.trainingPlanItem.create({
      data: {
        planId: plan.id,
        serialNo: nextSerial,
        subject: subject.trim(),
        participants: participants.trim(),
        faculty:        trimOrNull(faculty),
        scheduledMonth: trimOrNull(scheduledMonth),
        actualMonth:    trimOrNull(actualMonth),
        hoursPerMonth: hoursPerMonth != null && hoursPerMonth !== '' ? parseFloat(hoursPerMonth) : null,
        remarks:        trimOrNull(remarks),
        status: ITEM_STATUSES.includes(status) ? status : 'PLANNED',
        unitId: resolvedUnitId,
        category: trimOrNull(category),
        createdById: req.user.id,
      },
      include: {
        createdBy: { select: { id: true, name: true, role: true } },
        unit:      { select: { id: true, name: true, code: true } },
      },
    });
    res.status(201).json(item);
  } catch (e) {
    console.error('Add plan item:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/items/:itemId', authenticate, async (req, res) => {
  try {
    const item = await prisma.trainingPlanItem.findUnique({ where: { id: req.params.itemId } });
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (!canEditItem(req.user, item)) return res.status(403).json({ error: 'Forbidden' });

    const {
      subject, participants, faculty, scheduledMonth, actualMonth,
      hoursPerMonth, remarks, status, unitId, category,
    } = req.body || {};

    const data = {};
    if (subject !== undefined) {
      if (!subject?.trim()) return res.status(400).json({ error: 'Subject cannot be empty' });
      data.subject = subject.trim();
    }
    if (participants !== undefined) {
      if (!participants?.trim()) return res.status(400).json({ error: 'Participants cannot be empty' });
      data.participants = participants.trim();
    }
    if (faculty        !== undefined) data.faculty        = trimOrNull(faculty);
    if (scheduledMonth !== undefined) data.scheduledMonth = trimOrNull(scheduledMonth);
    if (actualMonth    !== undefined) data.actualMonth    = trimOrNull(actualMonth);
    if (hoursPerMonth  !== undefined)
      data.hoursPerMonth = hoursPerMonth != null && hoursPerMonth !== '' ? parseFloat(hoursPerMonth) : null;
    if (remarks        !== undefined) data.remarks        = trimOrNull(remarks);
    if (status !== undefined) {
      if (!ITEM_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
      data.status = status;
    }
    if (unitId !== undefined) {
      // Managers can't reassign an item to another unit.
      if (isManager(req.user) && !isHr(req.user) && unitId && unitId !== req.user.unitId) {
        return res.status(403).json({ error: 'Managers can only file items for their own unit' });
      }
      data.unitId = unitId || null;
    }
    if (category !== undefined) data.category = trimOrNull(category);

    const updated = await prisma.trainingPlanItem.update({
      where: { id: item.id },
      data,
      include: {
        createdBy: { select: { id: true, name: true, role: true } },
        unit:      { select: { id: true, name: true, code: true } },
      },
    });
    res.json(updated);
  } catch (e) {
    console.error('Update plan item:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/items/:itemId', authenticate, async (req, res) => {
  try {
    const item = await prisma.trainingPlanItem.findUnique({
      where: { id: req.params.itemId },
      include: { _count: { select: { sessions: true } } },
    });
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (!canEditItem(req.user, item)) return res.status(403).json({ error: 'Forbidden' });
    if (item._count.sessions > 0) {
      return res.status(400).json({ error: 'Cannot delete an item with linked training sessions.' });
    }
    await prisma.trainingPlanItem.delete({ where: { id: item.id } });
    res.json({ ok: true });
  } catch (e) {
    console.error('Delete plan item:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
