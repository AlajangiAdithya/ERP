// ──────────────────────────────────────────────────────────────
// Skill matrix (one row per employee, fixed-column 0–4 rating)
//
// Access:
//   • HR + ADMIN + SUPERADMIN: full edit
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

const canWrite = (user) =>
  !!user && (user.role === 'ADMIN' || user.role === 'HR' || user.role === 'SUPERADMIN');

const requireWrite = (req, res, next) => {
  if (!canWrite(req.user)) return res.status(403).json({ error: 'Forbidden' });
  next();
};

const sanitizeRating = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 4) return null;
  return n;
};

router.get('/permissions', authenticate, (req, res) => {
  res.json({ canWrite: canWrite(req.user) });
});

// GET /api/skill-matrix — list all employees with their skill rows joined.
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
    res.json({ employees, canWrite: canWrite(req.user) });
  } catch (e) {
    console.error('List skill matrix:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/skill-matrix/:employeeId — upsert the skill row for an employee.
router.put('/:employeeId', authenticate, requireWrite, async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({ where: { id: req.params.employeeId } });
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

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
router.post('/:employeeId/hod-sign', authenticate, requireWrite, (req, res) => {
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
