// ──────────────────────────────────────────────────────────────
// Employee register (HR module)
//
// Access:
//   • HR + ADMIN + SUPERADMIN: full edit
//   • All other auth'd users: view (so managers can pick employees when
//     creating training items / sessions for their team)
// ──────────────────────────────────────────────────────────────
const express = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const EMP_STATUSES = ['ACTIVE', 'INACTIVE'];

const canWrite = (user) =>
  !!user && (user.role === 'ADMIN' || user.role === 'HR' || user.role === 'SUPERADMIN');

const requireWrite = (req, res, next) => {
  if (!canWrite(req.user)) return res.status(403).json({ error: 'Forbidden' });
  next();
};

const toDate = (v) => (v ? new Date(v) : null);
const trimOrNull = (v) => {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === '' ? null : s;
};

const EMP_INCLUDE = {
  createdBy:   { select: { id: true, name: true } },
  user:        { select: { id: true, name: true, username: true, role: true } },
  skillMatrix: true,
  _count:      { select: { trainingAttended: true } },
};

router.get('/permissions', authenticate, (req, res) => {
  res.json({ canWrite: canWrite(req.user) });
});

// GET /api/employees
router.get('/', authenticate, async (req, res) => {
  try {
    const { q, category, status } = req.query;
    const where = {};
    if (status && EMP_STATUSES.includes(status)) where.status = status;
    if (category) where.category = category;
    if (q && q.trim()) {
      const term = q.trim();
      where.OR = [
        { name:        { contains: term, mode: 'insensitive' } },
        { empCode:     { contains: term, mode: 'insensitive' } },
        { designation: { contains: term, mode: 'insensitive' } },
        { category:    { contains: term, mode: 'insensitive' } },
      ];
    }
    const employees = await prisma.employee.findMany({
      where,
      include: EMP_INCLUDE,
      orderBy: [{ serialNo: 'asc' }, { name: 'asc' }],
    });
    res.json({ employees, canWrite: canWrite(req.user) });
  } catch (e) {
    console.error('List employees:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: req.params.id },
      include: {
        ...EMP_INCLUDE,
        trainingAttended: {
          include: {
            session: { select: { id: true, sessionNumber: true, subject: true, trainingDateFrom: true, faculty: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    res.json(employee);
  } catch (e) {
    console.error('Get employee:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/employees
router.post('/', authenticate, requireWrite, async (req, res) => {
  try {
    const {
      empCode, serialNo, name, designation, qualification, experience,
      category, department, phone, email, dateOfJoining, status, notes, userId,
    } = req.body || {};

    if (!empCode?.trim()) return res.status(400).json({ error: 'Employee code is required' });
    if (!name?.trim())    return res.status(400).json({ error: 'Employee name is required' });
    const code = empCode.trim().toUpperCase();

    const clash = await prisma.employee.findUnique({ where: { empCode: code } });
    if (clash) return res.status(400).json({ error: 'An employee with this code already exists' });

    // Auto serial number = max + 1 when not provided.
    let nextSerial = parseInt(serialNo, 10);
    if (!Number.isFinite(nextSerial) || nextSerial < 1) {
      const top = await prisma.employee.aggregate({ _max: { serialNo: true } });
      nextSerial = (top._max.serialNo || 0) + 1;
    }

    if (userId) {
      const u = await prisma.user.findUnique({ where: { id: userId } });
      if (!u) return res.status(400).json({ error: 'Linked user not found' });
      const taken = await prisma.employee.findUnique({ where: { userId } });
      if (taken) return res.status(400).json({ error: 'This user is already linked to another employee' });
    }

    const employee = await prisma.employee.create({
      data: {
        empCode: code,
        serialNo: nextSerial,
        name: name.trim(),
        designation: trimOrNull(designation),
        qualification: trimOrNull(qualification),
        experience: experience != null && experience !== '' ? parseInt(experience, 10) : null,
        category: trimOrNull(category),
        department: trimOrNull(department),
        phone: trimOrNull(phone),
        email: trimOrNull(email),
        dateOfJoining: toDate(dateOfJoining),
        status: EMP_STATUSES.includes(status) ? status : 'ACTIVE',
        notes: trimOrNull(notes),
        userId: userId || null,
        createdById: req.user.id,
      },
      include: EMP_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'EMPLOYEE_CREATE',
        entity: 'Employee',
        entityId: employee.id,
        details: { empCode: employee.empCode, name: employee.name },
        ipAddress: req.ip,
      },
    });

    res.status(201).json(employee);
  } catch (e) {
    console.error('Create employee:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', authenticate, requireWrite, async (req, res) => {
  try {
    const existing = await prisma.employee.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Employee not found' });

    const {
      empCode, serialNo, name, designation, qualification, experience,
      category, department, phone, email, dateOfJoining, status, notes, userId,
    } = req.body || {};

    const data = {};
    if (empCode !== undefined) {
      const code = empCode.trim().toUpperCase();
      if (!code) return res.status(400).json({ error: 'Employee code cannot be empty' });
      if (code !== existing.empCode) {
        const clash = await prisma.employee.findUnique({ where: { empCode: code } });
        if (clash) return res.status(400).json({ error: 'Another employee already uses this code' });
      }
      data.empCode = code;
    }
    if (serialNo !== undefined) {
      const n = parseInt(serialNo, 10);
      if (!Number.isFinite(n) || n < 1) return res.status(400).json({ error: 'Invalid serial number' });
      data.serialNo = n;
    }
    if (name !== undefined) {
      if (!name?.trim()) return res.status(400).json({ error: 'Name cannot be empty' });
      data.name = name.trim();
    }
    if (designation !== undefined)   data.designation   = trimOrNull(designation);
    if (qualification !== undefined) data.qualification = trimOrNull(qualification);
    if (experience !== undefined)
      data.experience = experience != null && experience !== '' ? parseInt(experience, 10) : null;
    if (category !== undefined)      data.category      = trimOrNull(category);
    if (department !== undefined)    data.department    = trimOrNull(department);
    if (phone !== undefined)         data.phone         = trimOrNull(phone);
    if (email !== undefined)         data.email         = trimOrNull(email);
    if (dateOfJoining !== undefined) data.dateOfJoining = toDate(dateOfJoining);
    if (status !== undefined) {
      if (!EMP_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
      data.status = status;
    }
    if (notes !== undefined) data.notes = trimOrNull(notes);
    if (userId !== undefined) {
      if (userId) {
        const u = await prisma.user.findUnique({ where: { id: userId } });
        if (!u) return res.status(400).json({ error: 'Linked user not found' });
        const taken = await prisma.employee.findFirst({ where: { userId, NOT: { id: existing.id } } });
        if (taken) return res.status(400).json({ error: 'This user is already linked to another employee' });
        data.userId = userId;
      } else {
        data.userId = null;
      }
    }

    const employee = await prisma.employee.update({
      where: { id: req.params.id },
      data,
      include: EMP_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'EMPLOYEE_UPDATE',
        entity: 'Employee',
        entityId: employee.id,
        details: { changes: Object.keys(data) },
        ipAddress: req.ip,
      },
    });

    res.json(employee);
  } catch (e) {
    console.error('Update employee:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/employees/:id — only when no training history references them.
router.delete('/:id', authenticate, requireWrite, async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { trainingAttended: true } } },
    });
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    if (employee._count.trainingAttended > 0) {
      return res.status(400).json({
        error: 'Cannot delete an employee with training history. Set status to INACTIVE instead.',
      });
    }
    await prisma.employee.delete({ where: { id: req.params.id } });
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'EMPLOYEE_DELETE',
        entity: 'Employee',
        entityId: employee.id,
        details: { empCode: employee.empCode, name: employee.name },
        ipAddress: req.ip,
      },
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('Delete employee:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
