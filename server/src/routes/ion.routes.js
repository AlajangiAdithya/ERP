// ──────────────────────────────────────────────────────────────
// Inter Office Note (ION) — work-order workflow
// Sender: MANAGER (always).
// Recipient: LAB (default — original lab testing flow)
//            OR another MANAGER (cross-unit machining flow).
// Doc: RAMS/ION/00
// ──────────────────────────────────────────────────────────────
const express = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { generateSequentialNumber, paginate, applyDateFilter, isUniqueViolation } = require('../utils/helpers');

const router = express.Router();

const ION_ROLES = ['MANAGER', 'LAB', 'METROLOGY', 'NDT', 'RND', 'DESIGNS', 'SAFETY'];
const ION_RECIPIENT_ROLES = ['LAB', 'METROLOGY', 'NDT', 'RND', 'DESIGNS'];

const ION_INCLUDE = {
  createdBy:  { select: { id: true, name: true, role: true, unit: { select: { name: true, code: true } } } },
  assignedTo: { select: { id: true, name: true, role: true, unit: { select: { name: true, code: true } } } },
  items: true,
};

// GET /api/ion — list, filtered by role + assignment
router.get('/', authenticate, authorize(...ION_ROLES), async (req, res) => {
  try {
    const { status, page, limit, fromDate, toDate } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    applyDateFilter(where, { fromDate, toDate });
    if (status && ['SENT', 'WAITING', 'COLLECTED'].includes(status)) where.status = status;

    if (req.user.role === 'MANAGER') {
      // Manager sees: their own outgoing OR ones assigned directly to them
      where.OR = [
        { createdById: req.user.id },
        { assignedToId: req.user.id },
      ];
    } else if (ION_RECIPIENT_ROLES.includes(req.user.role)) {
      // Recipient roles (LAB/METROLOGY/NDT/RND) see ions sent to their role:
      // either unassigned with createdBy targeting their role (handled implicitly
      // by recipientRole field — we filter on either no assignee with matching
      // role bucket OR assigned to a user of that same role).
      where.OR = [
        { assignedToId: null, recipientRole: req.user.role },
        { assignedTo: { is: { role: req.user.role } } },
      ];
    }
    // SAFETY: monitor — sees all ions, no filter applied.

    const [ions, total] = await Promise.all([
      prisma.interOfficeNote.findMany({
        where,
        include: ION_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.interOfficeNote.count({ where }),
    ]);

    res.json({
      ions, total,
      page: Math.ceil(skip / take) + 1,
      totalPages: Math.ceil(total / take),
    });
  } catch (error) {
    console.error('List ION error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/ion/:id — single. Sender, assignee, or LAB (for unassigned/lab-assigned) can see it.
router.get('/:id', authenticate, authorize(...ION_ROLES), async (req, res) => {
  try {
    const ion = await prisma.interOfficeNote.findUnique({
      where: { id: req.params.id },
      include: ION_INCLUDE,
    });
    if (!ion) return res.status(404).json({ error: 'ION not found' });

    if (req.user.role === 'MANAGER') {
      const isOwner = ion.createdById === req.user.id;
      const isAssignee = ion.assignedToId === req.user.id;
      if (!isOwner && !isAssignee) return res.status(403).json({ error: 'Not your ION' });
    }
    if (ION_RECIPIENT_ROLES.includes(req.user.role)) {
      const canSee =
        (!ion.assignedToId && ion.recipientRole === req.user.role) ||
        ion.assignedTo?.role === req.user.role;
      if (!canSee) return res.status(403).json({ error: 'Not your ION' });
    }
    // SAFETY: read-only monitor, can see everything.

    res.json(ion);
  } catch (error) {
    console.error('Get ION error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/ion — MANAGER creates
//   recipientType:  'LAB' (default) | 'METROLOGY' | 'NDT' | 'RND' | 'MANAGER'
//   assignedToId:   required when recipientType === 'MANAGER' (must be a MANAGER user id)
router.post('/', authenticate, authorize('MANAGER'), async (req, res) => {
  try {
    const {
      recipientType, assignedToId,
      userReferenceNo, section, projectName, supplyOrderNo, referenceDocQA,
      materialSupplyDate, sampleRequired, reportGeneration, requiredByDate,
      externalQAWitness, qcContactDetails, otherInformation, remarks, items,
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'At least one job item is required' });
    }
    for (const it of items) {
      if (!it.jobIdentification || !String(it.jobIdentification).trim()) {
        return res.status(400).json({ error: 'Each item requires a job identification' });
      }
    }

    let resolvedAssigneeId = null;
    let resolvedRecipientRole = 'LAB';
    if (recipientType === 'MANAGER') {
      if (!assignedToId) {
        return res.status(400).json({ error: 'Select a manager to send the ION to' });
      }
      if (assignedToId === req.user.id) {
        return res.status(400).json({ error: 'You cannot send an ION to yourself' });
      }
      const target = await prisma.user.findUnique({
        where: { id: assignedToId },
        select: { id: true, role: true, isActive: true },
      });
      if (!target || !target.isActive || target.role !== 'MANAGER') {
        return res.status(400).json({ error: 'Selected recipient is not an active manager' });
      }
      resolvedAssigneeId = target.id;
      resolvedRecipientRole = null;
    } else if (ION_RECIPIENT_ROLES.includes(recipientType)) {
      resolvedRecipientRole = recipientType;
    }

    const ionNumber = await generateSequentialNumber(prisma, 'ION');

    const ion = await prisma.interOfficeNote.create({
      data: {
        ionNumber,
        userReferenceNo: userReferenceNo || null,
        section: section || null,
        projectName: projectName || null,
        supplyOrderNo: supplyOrderNo || null,
        referenceDocQA: referenceDocQA || null,
        materialSupplyDate: materialSupplyDate ? new Date(materialSupplyDate) : null,
        sampleRequired: !!sampleRequired,
        reportGeneration: !!reportGeneration,
        requiredByDate: requiredByDate ? new Date(requiredByDate) : null,
        externalQAWitness: externalQAWitness || null,
        qcContactDetails: qcContactDetails || null,
        otherInformation: otherInformation || null,
        remarks: remarks || null,
        status: 'SENT',
        recipientRole: resolvedRecipientRole,
        createdById: req.user.id,
        assignedToId: resolvedAssigneeId,
        items: {
          create: items.map((it) => ({
            jobIdentification:   String(it.jobIdentification).trim(),
            activityRequired:    it.activityRequired || null,
            materialComposition: it.materialComposition || null,
            drawingNo:           it.drawingNo || null,
            specification:       it.specification || null,
          })),
        },
      },
      include: ION_INCLUDE,
    });

    if (resolvedAssigneeId) {
      await prisma.notification.create({
        data: {
          type: 'ION_RECEIVED',
          title: `New ION: ${ion.ionNumber}`,
          message: `${req.user.name} sent you an Inter Office Note (${ion.ionNumber})${projectName ? ` for project "${projectName}"` : ''}. Please review and start work.`,
          targetUserId: resolvedAssigneeId,
          sentById: req.user.id,
        },
      });
    } else {
      await prisma.notification.create({
        data: {
          type: 'ION_RECEIVED',
          title: `New ION: ${ion.ionNumber}`,
          message: `${req.user.name} sent a new Inter Office Note (${ion.ionNumber})${projectName ? ` for project "${projectName}"` : ''}. Please review and start work.`,
          targetRole: resolvedRecipientRole,
          sentById: req.user.id,
        },
      });
    }

    res.status(201).json(ion);
  } catch (error) {
    console.error('Create ION error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/ion/:id/status — recipient transitions SENT → WAITING → COLLECTED
//   Recipient = LAB/METROLOGY/NDT/RND user (for unassigned/role-assigned) OR the specific manager assigned to it.
router.put('/:id/status', authenticate, authorize('LAB', 'MANAGER', 'METROLOGY', 'NDT', 'RND', 'DESIGNS'), async (req, res) => {
  try {
    const { status, remarks } = req.body;
    if (!['WAITING', 'COLLECTED'].includes(status)) {
      return res.status(400).json({ error: 'Status must be WAITING or COLLECTED' });
    }

    const existing = await prisma.interOfficeNote.findUnique({
      where: { id: req.params.id },
      include: { assignedTo: { select: { id: true, role: true } }, createdBy: { select: { id: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'ION not found' });

    // Authorisation — only the recipient can move the status forward
    if (req.user.role === 'MANAGER') {
      if (existing.assignedToId !== req.user.id) {
        return res.status(403).json({ error: 'Only the assigned manager can update this ION' });
      }
    } else if (ION_RECIPIENT_ROLES.includes(req.user.role)) {
      const ownsByRole =
        (!existing.assignedToId && existing.recipientRole === req.user.role) ||
        existing.assignedTo?.role === req.user.role;
      if (!ownsByRole) {
        return res.status(403).json({ error: 'This ION is not addressed to your role' });
      }
    }

    if (status === 'WAITING' && existing.status !== 'SENT') {
      return res.status(400).json({ error: 'Can only move SENT → WAITING' });
    }
    if (status === 'COLLECTED' && existing.status !== 'WAITING') {
      return res.status(400).json({ error: 'Can only move WAITING → COLLECTED' });
    }

    const data = {
      status,
      remarks: remarks != null ? remarks : existing.remarks,
      assignedToId: existing.assignedToId || req.user.id,
    };
    if (status === 'COLLECTED') data.completedDate = new Date();

    const updated = await prisma.interOfficeNote.update({
      where: { id: req.params.id },
      data,
      include: ION_INCLUDE,
    });

    if (existing.createdBy?.id && existing.createdBy.id !== req.user.id) {
      const statusMsg = status === 'WAITING'
        ? `${req.user.name} has started work on your ION ${updated.ionNumber}.`
        : `Work on your ION ${updated.ionNumber} is complete. Your items are ready for collection from ${req.user.name}.`;
      await prisma.notification.create({
        data: {
          type: 'ION_STATUS_UPDATE',
          title: status === 'WAITING'
            ? `ION ${updated.ionNumber}: Work Started`
            : `ION ${updated.ionNumber}: Work Complete — Ready for Collection`,
          message: statusMsg,
          targetUserId: existing.createdBy.id,
          sentById: req.user.id,
        },
      });
    }

    res.json(updated);
  } catch (error) {
    console.error('Update ION status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
