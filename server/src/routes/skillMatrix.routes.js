// ──────────────────────────────────────────────────────────────
// Skill matrix (one row per employee, fixed-column 0–4 rating)
//
// Access:
//   • HR + ADMIN + SUPERADMIN: full edit on all employees
//   • MANAGER: edit only employees whose category is "Production UNIT N"
//             where N matches the manager's own unit code (1, 2, 3, 4, 5)
//   • Everyone else: view-only
// ──────────────────────────────────────────────────────────────
const express = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { trainingDocUpload, publicUrlFor } = require('../middleware/upload');

const router = express.Router();

const SKILL_FIELDS = [
  'qmsAwareness', 'risksOpportunities', 'processKnowledge', 'inspectionTesting',
  'qualityAnalytical', 'nonconformityAnalysis', 'customerRelations', 'supplierManagement',
  'projectPlanning', 'equipmentMaintenance', 'materialInventory', 'internalAuditing',
  'crisisManagement', 'communicationSkills', 'interPersonalRelations',
];

// "Production UNIT 1", "Production UNIT 2A" → capture group is the unit code
const UNIT_CATEGORY_RE = /^Production\s*UNIT\s*([0-9A-Z]+)\s*$/i;

const isHrLike = (u) => !!u && ['HR', 'ADMIN', 'SUPERADMIN'].includes(u.role);

const canEditEmployee = (user, employee) => {
  if (!user || !employee) return false;
  if (isHrLike(user)) return true;
  if (user.role !== 'MANAGER' || !user.unit?.code) return false;
  const m = (employee.category || '').match(UNIT_CATEGORY_RE);
  if (!m) return false;
  return String(m[1]).toUpperCase() === String(user.unit.code).toUpperCase();
};

// Top-level: does this user have edit rights anywhere? (Controls Save column UI.)
const canWriteAny = (user) =>
  isHrLike(user) || (user?.role === 'MANAGER' && !!user.unit?.code);

const sanitizeRating = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 4) return null;
  return n;
};

router.get('/permissions', authenticate, (req, res) => {
  res.json({ canWrite: canWriteAny(req.user) });
});

// GET /api/skill-matrix — list all employees with their skill rows joined.
// Each employee carries a `canEdit` flag derived from the requester's role + unit.
router.get('/', authenticate, async (req, res) => {
  try {
    const { category } = req.query;
    const where = { status: 'ACTIVE' };
    if (category) where.category = category;
    const employees = await prisma.employee.findMany({
      where,
      include: { skillMatrix: true },
      orderBy: [{ serialNo: 'asc' }, { name: 'asc' }],
    });
    const decorated = employees.map((e) => ({ ...e, canEdit: canEditEmployee(req.user, e) }));
    res.json({ employees: decorated, canWrite: canWriteAny(req.user) });
  } catch (e) {
    console.error('List skill matrix:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/skill-matrix/:employeeId — upsert the skill row for an employee.
router.put('/:employeeId', authenticate, async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({ where: { id: req.params.employeeId } });
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    if (!canEditEmployee(req.user, employee)) {
      return res.status(403).json({ error: 'Forbidden: you cannot edit this employee' });
    }

    const data = {};
    for (const f of SKILL_FIELDS) {
      if (req.body[f] !== undefined) data[f] = sanitizeRating(req.body[f]);
    }
    if (req.body.trainingNeeds !== undefined) data.trainingNeeds = req.body.trainingNeeds?.trim() || null;
    if (req.body.remarks       !== undefined) data.remarks       = req.body.remarks?.trim()       || null;
    if (req.body.ratedOn       !== undefined) data.ratedOn       = req.body.ratedOn ? new Date(req.body.ratedOn) : null;

    const row = await prisma.skillMatrix.upsert({
      where:  { employeeId: employee.id },
      create: { employeeId: employee.id, ...data },
      update: data,
    });

    res.json(row);
  } catch (e) {
    console.error('Upsert skill matrix:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/skill-matrix/:employeeId/hod-sign — upload Head-of-Dept sign file.
router.post('/:employeeId/hod-sign', authenticate, async (req, res) => {
  const employee = await prisma.employee.findUnique({ where: { id: req.params.employeeId } });
  if (!employee) return res.status(404).json({ error: 'Employee not found' });
  if (!canEditEmployee(req.user, employee)) {
    return res.status(403).json({ error: 'Forbidden: you cannot edit this employee' });
  }
  trainingDocUpload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    try {
      const url = publicUrlFor('training-docs', req.file.filename);
      const row = await prisma.skillMatrix.upsert({
        where:  { employeeId: req.params.employeeId },
        create: { employeeId: req.params.employeeId, headOfDeptSig: url },
        update: { headOfDeptSig: url },
      });
      res.json(row);
    } catch (e) {
      console.error('Upload HoD sign:', e);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
});

module.exports = router;
