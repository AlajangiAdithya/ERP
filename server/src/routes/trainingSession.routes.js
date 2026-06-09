// ──────────────────────────────────────────────────────────────
// Training session records — one row per actual training delivered.
// Holds attendee list + per-attendee evaluation + uploaded notes/eval/feedback.
//
// Access:
//   • HR + ADMIN + SUPERADMIN: full edit
//   • MANAGER: can create / edit sessions tied to their own plan items
//   • Everyone else: view-only
// ──────────────────────────────────────────────────────────────
const express = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { trainingDocUpload, publicUrlFor } = require('../middleware/upload');

const router = express.Router();

const isHr      = (u) => !!u && (u.role === 'HR' || u.role === 'ADMIN' || u.role === 'SUPERADMIN');
const isManager = (u) => !!u && u.role === 'MANAGER';

const trimOrNull = (v) => {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === '' ? null : s;
};
const toDate = (v) => (v ? new Date(v) : null);

const SESSION_INCLUDE = {
  createdBy: { select: { id: true, name: true, role: true } },
  plan:      { select: { id: true, fiscalYear: true, title: true } },
  planItem:  { select: { id: true, subject: true, serialNo: true } },
  attendees: {
    include: {
      employee: { select: { id: true, empCode: true, name: true, designation: true, category: true } },
    },
  },
};

const canEditSession = (user, session) => {
  if (isHr(user)) return true;
  if (isManager(user)) {
    if (session.createdById === user.id) return true;
    if (session.planItem && session.planItem.createdById === user.id) return true;
  }
  return false;
};

const generateSessionNumber = async () => {
  const yr = new Date().getFullYear();
  const top = await prisma.trainingSession.findMany({
    where: { sessionNumber: { startsWith: `TS-${yr}-` } },
    orderBy: { sessionNumber: 'desc' },
    take: 1,
    select: { sessionNumber: true },
  });
  let next = 1;
  if (top.length) {
    const m = top[0].sessionNumber.match(/(\d+)$/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return `TS-${yr}-${String(next).padStart(4, '0')}`;
};

router.get('/permissions', authenticate, (req, res) => {
  res.json({ canCreate: isHr(req.user) || isManager(req.user) });
});

// GET /api/training-sessions
router.get('/', authenticate, async (req, res) => {
  try {
    const { planId, planItemId, employeeId, fromDate, toDate: untilDate } = req.query;
    const where = {};
    if (planId)     where.planId     = planId;
    if (planItemId) where.planItemId = planItemId;
    if (employeeId) where.attendees = { some: { employeeId } };
    if (fromDate || untilDate) {
      where.trainingDateFrom = {};
      if (fromDate)  where.trainingDateFrom.gte = new Date(fromDate);
      if (untilDate) where.trainingDateFrom.lte = new Date(untilDate);
    }
    const sessions = await prisma.trainingSession.findMany({
      where,
      include: SESSION_INCLUDE,
      orderBy: { trainingDateFrom: 'desc' },
    });
    res.json({ sessions });
  } catch (e) {
    console.error('List sessions:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const session = await prisma.trainingSession.findUnique({
      where: { id: req.params.id },
      include: SESSION_INCLUDE,
    });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  } catch (e) {
    console.error('Get session:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', authenticate, async (req, res) => {
  if (!isHr(req.user) && !isManager(req.user)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const {
      planId, planItemId, subject, trainingDateFrom, trainingDateTo,
      duration, place, faculty, reference, notes, attendees,
    } = req.body || {};

    if (!subject?.trim())   return res.status(400).json({ error: 'Subject is required' });
    if (!faculty?.trim())   return res.status(400).json({ error: 'Faculty is required' });
    if (!trainingDateFrom)  return res.status(400).json({ error: 'Training start date is required' });

    if (planItemId) {
      const planItem = await prisma.trainingPlanItem.findUnique({ where: { id: planItemId } });
      if (!planItem) return res.status(400).json({ error: 'Plan item not found' });
      if (isManager(req.user) && !isHr(req.user)
        && planItem.createdById !== req.user.id
        && planItem.unitId !== req.user.unitId) {
        return res.status(403).json({ error: 'You can only log sessions for your own plan items' });
      }
    }

    const sessionNumber = await generateSessionNumber();

    const session = await prisma.trainingSession.create({
      data: {
        sessionNumber,
        planId:     planId    || null,
        planItemId: planItemId || null,
        subject: subject.trim(),
        trainingDateFrom: new Date(trainingDateFrom),
        trainingDateTo: toDate(trainingDateTo),
        duration:  trimOrNull(duration),
        place:     trimOrNull(place),
        faculty:   faculty.trim(),
        reference: trimOrNull(reference),
        notes:     trimOrNull(notes),
        createdById: req.user.id,
        attendees: Array.isArray(attendees) && attendees.length
          ? {
              create: attendees
                .filter((a) => a && a.employeeId)
                .map((a) => ({
                  employeeId: a.employeeId,
                  evaluationDetails: trimOrNull(a.evaluationDetails) ?? null,
                  dateOfEvaluation:  toDate(a.dateOfEvaluation),
                  evaluatedBy:       trimOrNull(a.evaluatedBy) ?? null,
                })),
            }
          : undefined,
      },
      include: SESSION_INCLUDE,
    });
    res.status(201).json(session);
  } catch (e) {
    console.error('Create session:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', authenticate, async (req, res) => {
  try {
    const session = await prisma.trainingSession.findUnique({
      where: { id: req.params.id },
      include: { planItem: { select: { createdById: true } } },
    });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!canEditSession(req.user, session)) return res.status(403).json({ error: 'Forbidden' });

    const {
      subject, trainingDateFrom, trainingDateTo, duration, place, faculty,
      reference, notes, planId, planItemId,
    } = req.body || {};

    const data = {};
    if (subject !== undefined) {
      if (!subject?.trim()) return res.status(400).json({ error: 'Subject cannot be empty' });
      data.subject = subject.trim();
    }
    if (trainingDateFrom !== undefined) data.trainingDateFrom = new Date(trainingDateFrom);
    if (trainingDateTo   !== undefined) data.trainingDateTo   = toDate(trainingDateTo);
    if (duration  !== undefined) data.duration  = trimOrNull(duration);
    if (place     !== undefined) data.place     = trimOrNull(place);
    if (faculty   !== undefined) {
      if (!faculty?.trim()) return res.status(400).json({ error: 'Faculty cannot be empty' });
      data.faculty = faculty.trim();
    }
    if (reference !== undefined) data.reference = trimOrNull(reference);
    if (notes     !== undefined) data.notes     = trimOrNull(notes);
    if (planId    !== undefined) data.planId    = planId    || null;
    if (planItemId !== undefined) data.planItemId = planItemId || null;

    const updated = await prisma.trainingSession.update({
      where: { id: session.id },
      data,
      include: SESSION_INCLUDE,
    });
    res.json(updated);
  } catch (e) {
    console.error('Update session:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', authenticate, async (req, res) => {
  try {
    const session = await prisma.trainingSession.findUnique({
      where: { id: req.params.id },
      include: { planItem: { select: { createdById: true } } },
    });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!canEditSession(req.user, session)) return res.status(403).json({ error: 'Forbidden' });
    await prisma.trainingSession.delete({ where: { id: session.id } });
    res.json({ ok: true });
  } catch (e) {
    console.error('Delete session:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Attendee management ──
router.post('/:id/attendees', authenticate, async (req, res) => {
  try {
    const session = await prisma.trainingSession.findUnique({
      where: { id: req.params.id },
      include: { planItem: { select: { createdById: true } } },
    });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!canEditSession(req.user, session)) return res.status(403).json({ error: 'Forbidden' });

    const { employeeId, evaluationDetails, dateOfEvaluation, evaluatedBy } = req.body || {};
    if (!employeeId) return res.status(400).json({ error: 'employeeId is required' });

    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) return res.status(400).json({ error: 'Employee not found' });

    const dup = await prisma.trainingAttendee.findUnique({
      where: { sessionId_employeeId: { sessionId: session.id, employeeId } },
    });
    if (dup) return res.status(400).json({ error: 'This employee is already in the session' });

    const att = await prisma.trainingAttendee.create({
      data: {
        sessionId: session.id,
        employeeId,
        evaluationDetails: trimOrNull(evaluationDetails) ?? null,
        dateOfEvaluation:  toDate(dateOfEvaluation),
        evaluatedBy:       trimOrNull(evaluatedBy) ?? null,
      },
      include: { employee: { select: { id: true, empCode: true, name: true, designation: true, category: true } } },
    });
    res.status(201).json(att);
  } catch (e) {
    console.error('Add attendee:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id/attendees/:attendeeId', authenticate, async (req, res) => {
  try {
    const session = await prisma.trainingSession.findUnique({
      where: { id: req.params.id },
      include: { planItem: { select: { createdById: true } } },
    });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!canEditSession(req.user, session)) return res.status(403).json({ error: 'Forbidden' });

    const { evaluationDetails, dateOfEvaluation, evaluatedBy } = req.body || {};
    const data = {};
    if (evaluationDetails !== undefined) data.evaluationDetails = trimOrNull(evaluationDetails) ?? null;
    if (dateOfEvaluation  !== undefined) data.dateOfEvaluation  = toDate(dateOfEvaluation);
    if (evaluatedBy       !== undefined) data.evaluatedBy       = trimOrNull(evaluatedBy) ?? null;

    const att = await prisma.trainingAttendee.update({
      where: { id: req.params.attendeeId },
      data,
      include: { employee: { select: { id: true, empCode: true, name: true, designation: true, category: true } } },
    });
    res.json(att);
  } catch (e) {
    console.error('Update attendee:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id/attendees/:attendeeId', authenticate, async (req, res) => {
  try {
    const session = await prisma.trainingSession.findUnique({
      where: { id: req.params.id },
      include: { planItem: { select: { createdById: true } } },
    });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!canEditSession(req.user, session)) return res.status(403).json({ error: 'Forbidden' });
    await prisma.trainingAttendee.delete({ where: { id: req.params.attendeeId } });
    res.json({ ok: true });
  } catch (e) {
    console.error('Delete attendee:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── File uploads ──
const fileFields = ['trainingNotes', 'evaluation', 'feedback', 'facultySign'];
const fieldColumnMap = {
  trainingNotes: 'trainingNotesUrl',
  evaluation:    'evaluationUrl',
  feedback:      'feedbackUrl',
  facultySign:   'facultySign',
};

router.post('/:id/upload/:field', authenticate, (req, res, next) => {
  if (!fileFields.includes(req.params.field)) return res.status(400).json({ error: 'Unknown upload field' });
  next();
}, (req, res) => {
  trainingDocUpload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    try {
      const session = await prisma.trainingSession.findUnique({
        where: { id: req.params.id },
        include: { planItem: { select: { createdById: true } } },
      });
      if (!session) return res.status(404).json({ error: 'Session not found' });
      if (!canEditSession(req.user, session)) return res.status(403).json({ error: 'Forbidden' });
      const url = publicUrlFor('training-docs', req.file.filename);
      const updated = await prisma.trainingSession.update({
        where: { id: session.id },
        data: { [fieldColumnMap[req.params.field]]: url },
        include: SESSION_INCLUDE,
      });
      res.json(updated);
    } catch (e) {
      console.error('Upload session file:', e);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
});

router.post('/:id/attendees/:attendeeId/sign', authenticate, (req, res) => {
  trainingDocUpload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    try {
      const session = await prisma.trainingSession.findUnique({
        where: { id: req.params.id },
        include: { planItem: { select: { createdById: true } } },
      });
      if (!session) return res.status(404).json({ error: 'Session not found' });
      if (!canEditSession(req.user, session)) return res.status(403).json({ error: 'Forbidden' });
      const url = publicUrlFor('training-docs', req.file.filename);
      const att = await prisma.trainingAttendee.update({
        where: { id: req.params.attendeeId },
        data: { signUrl: url },
        include: { employee: { select: { id: true, empCode: true, name: true, designation: true, category: true } } },
      });
      res.json(att);
    } catch (e) {
      console.error('Upload attendee sign:', e);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
});

module.exports = router;
