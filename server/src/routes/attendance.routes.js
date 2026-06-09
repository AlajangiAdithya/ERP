// ──────────────────────────────────────────────────────────────
// Attendance register
//
// Access model:
//   • Edit (employees + day cells + month submission): the MANAGER whose
//     unitId matches the row's unitId. SUPERADMIN bypasses every check.
//   • View-only:
//       - ADMIN, SAFETY                 — can view every unit's current grid
//                                         (status of who came today / month-to-date)
//       - ACCOUNTING                    — can view a unit-month only after
//                                         the manager has submitted it.
//   • Modification trail (modifiedAt / modifiedBy / history) is stripped
//     from the API response for everyone except the unit's own manager.
//     "the modified info cannot be seen by the admins or anyone."
// ──────────────────────────────────────────────────────────────
const express = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// ── helpers ────────────────────────────────────────────────────
const isManagerOfUnit = (user, unitId) =>
  !!user && user.role === 'MANAGER' && user.unitId === unitId;

const canEditUnit = (user, unitId) => {
  if (!user || !unitId) return false;
  if (user.role === 'SUPERADMIN') return true;
  return isManagerOfUnit(user, unitId);
};

const VIEW_ROLES = new Set(['ADMIN', 'SAFETY', 'ACCOUNTING', 'SUPERADMIN', 'MANAGER']);
const canViewUnit = (user, unitId) => {
  if (!user || !unitId) return false;
  if (user.role === 'SUPERADMIN' || user.role === 'ADMIN' || user.role === 'SAFETY') return true;
  if (user.role === 'MANAGER') return user.unitId === unitId;
  // ACCOUNTING handled separately per-month (only sees submitted months).
  if (user.role === 'ACCOUNTING') return true;
  return false;
};

const stripModificationMeta = (entry) => {
  if (!entry) return entry;
  const { modifiedAt, modifiedById, modifiedByName, history, firstSavedAt, ...rest } = entry;
  return rest;
};

const parseYearMonth = (req) => {
  const year = parseInt(req.query.year, 10);
  const month = parseInt(req.query.month, 10);
  if (!Number.isFinite(year) || year < 2000 || year > 2100) return null;
  if (!Number.isFinite(month) || month < 1 || month > 12) return null;
  return { year, month };
};

const daysInMonth = (year, month) => new Date(year, month, 0).getDate();

const monthDateRange = (year, month) => {
  // [start, end) — UTC dates so the @db.Date column compares cleanly.
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start, end };
};

// "HH:mm" validator (24h). Returns trimmed value or null.
const normalizeTime = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === '') return null;
  // Accept "9:30", "09:30", "9:5" — normalize to "HH:mm".
  const m = s.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return undefined; // signal "invalid"
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return undefined;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

const normalizeStatus = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().toUpperCase();
  return s === '' ? null : s.slice(0, 16);
};

// ── permissions probe ──────────────────────────────────────────
router.get('/permissions', authenticate, async (req, res) => {
  const user = req.user;
  res.json({
    role: user.role,
    unitId: user.unitId,
    canSeeAllUnits: ['ADMIN', 'SAFETY', 'SUPERADMIN', 'ACCOUNTING'].includes(user.role),
    canEditOwnUnit: user.role === 'MANAGER' || user.role === 'SUPERADMIN',
  });
});

// ── list units the caller can pick from ────────────────────────
router.get('/units', authenticate, async (req, res) => {
  try {
    const user = req.user;
    let units;
    if (['ADMIN', 'SAFETY', 'SUPERADMIN', 'ACCOUNTING'].includes(user.role)) {
      units = await prisma.unit.findMany({
        where: { isActive: true },
        select: { id: true, name: true, code: true },
        orderBy: { code: 'asc' },
      });
    } else if (user.role === 'MANAGER' && user.unitId) {
      const u = await prisma.unit.findUnique({
        where: { id: user.unitId },
        select: { id: true, name: true, code: true },
      });
      units = u ? [u] : [];
    } else {
      units = [];
    }
    res.json({ units });
  } catch (error) {
    console.error('List attendance units error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── employees ──────────────────────────────────────────────────
router.get('/employees', authenticate, async (req, res) => {
  try {
    const unitId = String(req.query.unitId || '').trim();
    if (!unitId) return res.status(400).json({ error: 'unitId is required' });
    if (!canViewUnit(req.user, unitId)) return res.status(403).json({ error: 'Forbidden' });

    const employees = await prisma.attendanceEmployee.findMany({
      where: { unitId, isActive: true },
      orderBy: { serialNo: 'asc' },
      select: { id: true, serialNo: true, name: true, empCode: true },
    });
    res.json({ employees, canEdit: canEditUnit(req.user, unitId) });
  } catch (error) {
    console.error('List attendance employees error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/employees', authenticate, async (req, res) => {
  try {
    const { unitId, name, empCode, serialNo } = req.body || {};
    if (!unitId) return res.status(400).json({ error: 'unitId is required' });
    if (!canEditUnit(req.user, unitId)) return res.status(403).json({ error: 'Only the unit manager can add employees' });
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });

    let serial = parseInt(serialNo, 10);
    if (!Number.isFinite(serial) || serial <= 0) {
      const last = await prisma.attendanceEmployee.findFirst({
        where: { unitId },
        orderBy: { serialNo: 'desc' },
      });
      serial = (last?.serialNo || 0) + 1;
    } else {
      const clash = await prisma.attendanceEmployee.findUnique({
        where: { unitId_serialNo: { unitId, serialNo: serial } },
      });
      if (clash) return res.status(400).json({ error: 'That SL NO is already in use for this unit' });
    }

    const emp = await prisma.attendanceEmployee.create({
      data: {
        unitId,
        serialNo: serial,
        name: name.trim(),
        empCode: empCode?.trim() || null,
        createdById: req.user.id,
      },
      select: { id: true, serialNo: true, name: true, empCode: true },
    });
    res.status(201).json(emp);
  } catch (error) {
    console.error('Create attendance employee error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/employees/:id', authenticate, async (req, res) => {
  try {
    const existing = await prisma.attendanceEmployee.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Employee not found' });
    if (!canEditUnit(req.user, existing.unitId)) return res.status(403).json({ error: 'Only the unit manager can edit employees' });

    const { name, empCode, serialNo, isActive } = req.body || {};
    const data = {};
    if (name !== undefined) {
      if (!name?.trim()) return res.status(400).json({ error: 'Name cannot be empty' });
      data.name = name.trim();
    }
    if (empCode !== undefined) data.empCode = empCode?.trim() || null;
    if (serialNo !== undefined) {
      const n = parseInt(serialNo, 10);
      if (Number.isFinite(n) && n > 0 && n !== existing.serialNo) {
        const clash = await prisma.attendanceEmployee.findUnique({
          where: { unitId_serialNo: { unitId: existing.unitId, serialNo: n } },
        });
        if (clash) return res.status(400).json({ error: 'That SL NO is already in use for this unit' });
        data.serialNo = n;
      }
    }
    if (isActive !== undefined) data.isActive = !!isActive;

    const emp = await prisma.attendanceEmployee.update({
      where: { id: existing.id },
      data,
      select: { id: true, serialNo: true, name: true, empCode: true, isActive: true },
    });
    res.json(emp);
  } catch (error) {
    console.error('Update attendance employee error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/employees/:id', authenticate, async (req, res) => {
  try {
    const existing = await prisma.attendanceEmployee.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Employee not found' });
    if (!canEditUnit(req.user, existing.unitId)) return res.status(403).json({ error: 'Only the unit manager can remove employees' });

    // Soft-delete to preserve any historical month entries.
    await prisma.attendanceEmployee.update({
      where: { id: existing.id },
      data: { isActive: false },
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('Delete attendance employee error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── month grid ─────────────────────────────────────────────────
// GET /api/attendance/grid?unitId=&year=&month=
// Returns: { unit, year, month, days, employees: [{...}], entries: [{...}],
//           submission, canEdit, isManager }
router.get('/grid', authenticate, async (req, res) => {
  try {
    const unitId = String(req.query.unitId || '').trim();
    if (!unitId) return res.status(400).json({ error: 'unitId is required' });
    const ym = parseYearMonth(req);
    if (!ym) return res.status(400).json({ error: 'Valid year & month required' });

    // ACCOUNTING gating — they only see a unit-month after submission.
    const user = req.user;
    if (user.role === 'ACCOUNTING') {
      const sub = await prisma.attendanceMonthSubmission.findUnique({
        where: { unitId_year_month: { unitId, year: ym.year, month: ym.month } },
      });
      if (!sub) return res.status(403).json({ error: 'Accounts can only view submitted months' });
    } else if (!canViewUnit(user, unitId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const [unit, employees, submission] = await Promise.all([
      prisma.unit.findUnique({ where: { id: unitId }, select: { id: true, name: true, code: true } }),
      prisma.attendanceEmployee.findMany({
        where: { unitId, isActive: true },
        orderBy: { serialNo: 'asc' },
        select: { id: true, serialNo: true, name: true, empCode: true },
      }),
      prisma.attendanceMonthSubmission.findUnique({
        where: { unitId_year_month: { unitId, year: ym.year, month: ym.month } },
        select: { id: true, submittedAt: true, submittedById: true },
      }),
    ]);
    if (!unit) return res.status(404).json({ error: 'Unit not found' });

    const { start, end } = monthDateRange(ym.year, ym.month);
    const empIds = employees.map((e) => e.id);
    const rawEntries = empIds.length
      ? await prisma.attendanceEntry.findMany({
          where: { employeeId: { in: empIds }, date: { gte: start, lt: end } },
          orderBy: [{ employeeId: 'asc' }, { date: 'asc' }],
        })
      : [];

    const isOwnManager = isManagerOfUnit(user, unitId) || user.role === 'SUPERADMIN';
    const entries = rawEntries.map((e) => {
      const base = {
        id: e.id,
        employeeId: e.employeeId,
        date: e.date.toISOString().slice(0, 10),
        inTime: e.inTime,
        outTime: e.outTime,
        statusCode: e.statusCode,
      };
      if (!isOwnManager) return base;
      // Managers see the full modification trail.
      return {
        ...base,
        modifiedAt: e.modifiedAt,
        modifiedById: e.modifiedById,
        modifiedByName: e.modifiedByName,
        history: e.history || [],
        firstSavedAt: e.firstSavedAt,
      };
    });

    res.json({
      unit,
      year: ym.year,
      month: ym.month,
      days: daysInMonth(ym.year, ym.month),
      employees,
      entries,
      submission: submission || null,
      canEdit: canEditUnit(user, unitId) && !submission, // once submitted, locked
      isManager: isOwnManager,
    });
  } catch (error) {
    console.error('Attendance grid error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── upsert a single day cell ───────────────────────────────────
// PUT /api/attendance/entry
// body: { employeeId, date: "YYYY-MM-DD", inTime?, outTime?, statusCode? }
// Any field passed (even null) is applied; absent fields are left untouched.
router.put('/entry', authenticate, async (req, res) => {
  try {
    const { employeeId, date } = req.body || {};
    if (!employeeId) return res.status(400).json({ error: 'employeeId is required' });
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });

    const emp = await prisma.attendanceEmployee.findUnique({ where: { id: employeeId } });
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    if (!canEditUnit(req.user, emp.unitId)) return res.status(403).json({ error: 'Only the unit manager can edit this register' });

    const ymd = date.split('-').map((p) => parseInt(p, 10));
    const dayDate = new Date(Date.UTC(ymd[0], ymd[1] - 1, ymd[2]));

    // Reject edits after the month has been submitted (managers can still
    // edit previous months that have NOT been sent to accounts).
    const submission = await prisma.attendanceMonthSubmission.findUnique({
      where: { unitId_year_month: { unitId: emp.unitId, year: ymd[0], month: ymd[1] } },
    });
    if (submission && req.user.role !== 'SUPERADMIN') {
      return res.status(409).json({ error: 'This month has been sent to accounts and is locked' });
    }

    const body = req.body || {};
    const patch = {};
    if ('inTime' in body) {
      const v = normalizeTime(body.inTime);
      if (v === undefined) return res.status(400).json({ error: 'inTime must be HH:mm' });
      patch.inTime = v;
    }
    if ('outTime' in body) {
      const v = normalizeTime(body.outTime);
      if (v === undefined) return res.status(400).json({ error: 'outTime must be HH:mm' });
      patch.outTime = v;
    }
    if ('statusCode' in body) {
      patch.statusCode = normalizeStatus(body.statusCode);
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });

    const existing = await prisma.attendanceEntry.findUnique({
      where: { employeeId_date: { employeeId, date: dayDate } },
    });

    if (!existing) {
      // First save — no modification trail yet.
      const created = await prisma.attendanceEntry.create({
        data: {
          employeeId,
          date: dayDate,
          inTime: patch.inTime ?? null,
          outTime: patch.outTime ?? null,
          statusCode: patch.statusCode ?? null,
        },
      });
      return res.json({
        id: created.id,
        employeeId: created.employeeId,
        date: created.date.toISOString().slice(0, 10),
        inTime: created.inTime,
        outTime: created.outTime,
        statusCode: created.statusCode,
        modifiedAt: null,
        modifiedById: null,
        modifiedByName: null,
        history: [],
        firstSavedAt: created.firstSavedAt,
        wasModified: false,
      });
    }

    // Subsequent save — diff against existing values and append history.
    const next = {
      inTime: 'inTime' in patch ? patch.inTime : existing.inTime,
      outTime: 'outTime' in patch ? patch.outTime : existing.outTime,
      statusCode: 'statusCode' in patch ? patch.statusCode : existing.statusCode,
    };
    const changed = (next.inTime !== existing.inTime)
      || (next.outTime !== existing.outTime)
      || (next.statusCode !== existing.statusCode);

    if (!changed) {
      return res.json({
        id: existing.id,
        employeeId: existing.employeeId,
        date: existing.date.toISOString().slice(0, 10),
        inTime: existing.inTime,
        outTime: existing.outTime,
        statusCode: existing.statusCode,
        modifiedAt: existing.modifiedAt,
        modifiedById: existing.modifiedById,
        modifiedByName: existing.modifiedByName,
        history: existing.history || [],
        firstSavedAt: existing.firstSavedAt,
        wasModified: !!existing.modifiedAt,
      });
    }

    const historyArr = Array.isArray(existing.history) ? existing.history : [];
    historyArr.push({
      at: new Date().toISOString(),
      byId: req.user.id,
      byName: req.user.name,
      from: { inTime: existing.inTime, outTime: existing.outTime, statusCode: existing.statusCode },
      to: next,
    });

    const updated = await prisma.attendanceEntry.update({
      where: { id: existing.id },
      data: {
        inTime: next.inTime,
        outTime: next.outTime,
        statusCode: next.statusCode,
        modifiedAt: new Date(),
        modifiedById: req.user.id,
        modifiedByName: req.user.name,
        history: historyArr,
      },
    });

    res.json({
      id: updated.id,
      employeeId: updated.employeeId,
      date: updated.date.toISOString().slice(0, 10),
      inTime: updated.inTime,
      outTime: updated.outTime,
      statusCode: updated.statusCode,
      modifiedAt: updated.modifiedAt,
      modifiedById: updated.modifiedById,
      modifiedByName: updated.modifiedByName,
      history: updated.history || [],
      firstSavedAt: updated.firstSavedAt,
      wasModified: true,
    });
  } catch (error) {
    console.error('Upsert attendance entry error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── monthly summary (for accounts) ─────────────────────────────
// Computes per-employee totals from raw IN/OUT times. Standard-day threshold:
// total - 9h is OT (matches the Excel formula: IF(total>=10h, total-9h, 0)).
const STANDARD_DAY_MIN = 9 * 60;
const OT_THRESHOLD_MIN = 60; // only count OT when day total exceeds 9h by ≥ 1h

const minutesOf = (hhmm) => {
  if (!hhmm) return null;
  const [h, m] = String(hhmm).split(':').map((p) => parseInt(p, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
};

const summarizeEmployee = (entries, days) => {
  let daysWorked = 0;
  let totalMin = 0;
  let otMin = 0;
  const statusCounts = {};
  for (const e of entries) {
    if (e.statusCode) {
      statusCounts[e.statusCode] = (statusCounts[e.statusCode] || 0) + 1;
      continue;
    }
    const a = minutesOf(e.inTime);
    const b = minutesOf(e.outTime);
    if (a == null || b == null) continue;
    const span = b - a;
    if (span <= 0) continue;
    daysWorked += 1;
    totalMin += span;
    const over = span - STANDARD_DAY_MIN;
    if (over >= OT_THRESHOLD_MIN) otMin += over;
  }
  return {
    daysWorked,
    totalMinutes: totalMin,
    otMinutes: otMin,
    statusCounts,
    days,
  };
};

router.get('/monthly-summary', authenticate, async (req, res) => {
  try {
    const unitId = String(req.query.unitId || '').trim();
    if (!unitId) return res.status(400).json({ error: 'unitId is required' });
    const ym = parseYearMonth(req);
    if (!ym) return res.status(400).json({ error: 'Valid year & month required' });

    const user = req.user;
    if (user.role === 'ACCOUNTING') {
      const sub = await prisma.attendanceMonthSubmission.findUnique({
        where: { unitId_year_month: { unitId, year: ym.year, month: ym.month } },
      });
      if (!sub) return res.status(403).json({ error: 'Accounts can only view submitted months' });
    } else if (!canViewUnit(user, unitId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const employees = await prisma.attendanceEmployee.findMany({
      where: { unitId, isActive: true },
      orderBy: { serialNo: 'asc' },
      select: { id: true, serialNo: true, name: true, empCode: true },
    });
    const { start, end } = monthDateRange(ym.year, ym.month);
    const empIds = employees.map((e) => e.id);
    const allEntries = empIds.length
      ? await prisma.attendanceEntry.findMany({
          where: { employeeId: { in: empIds }, date: { gte: start, lt: end } },
          select: { employeeId: true, inTime: true, outTime: true, statusCode: true },
        })
      : [];

    const byEmp = new Map();
    for (const e of allEntries) {
      if (!byEmp.has(e.employeeId)) byEmp.set(e.employeeId, []);
      byEmp.get(e.employeeId).push(e);
    }

    const days = daysInMonth(ym.year, ym.month);
    const rows = employees.map((emp) => {
      const sum = summarizeEmployee(byEmp.get(emp.id) || [], days);
      return { ...emp, ...sum };
    });

    const submission = await prisma.attendanceMonthSubmission.findUnique({
      where: { unitId_year_month: { unitId, year: ym.year, month: ym.month } },
      include: { submittedBy: { select: { id: true, name: true } } },
    });

    res.json({
      unitId,
      year: ym.year,
      month: ym.month,
      days,
      rows,
      submission: submission
        ? { id: submission.id, submittedAt: submission.submittedAt, submittedBy: submission.submittedBy }
        : null,
    });
  } catch (error) {
    console.error('Attendance monthly summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── send to accounts ───────────────────────────────────────────
// POST /api/attendance/submit  body: { unitId, year, month }
router.post('/submit', authenticate, async (req, res) => {
  try {
    const { unitId, year, month } = req.body || {};
    if (!unitId) return res.status(400).json({ error: 'unitId is required' });
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
      return res.status(400).json({ error: 'Valid year & month required' });
    }
    if (!canEditUnit(req.user, unitId)) return res.status(403).json({ error: 'Only the unit manager can submit' });

    const existing = await prisma.attendanceMonthSubmission.findUnique({
      where: { unitId_year_month: { unitId, year: y, month: m } },
    });
    if (existing) return res.status(409).json({ error: 'Already sent to accounts' });

    const submission = await prisma.attendanceMonthSubmission.create({
      data: {
        unitId,
        year: y,
        month: m,
        submittedById: req.user.id,
      },
    });

    // Best-effort notification to ACCOUNTING + ADMIN.
    try {
      const targets = await prisma.user.findMany({
        where: { role: { in: ['ACCOUNTING', 'ADMIN'] }, isActive: true },
        select: { id: true },
      });
      const unit = await prisma.unit.findUnique({ where: { id: unitId }, select: { name: true, code: true } });
      const monthName = new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long' });
      const msg = `${unit?.name || 'Unit'} attendance for ${monthName} ${y} has been sent to accounts.`;
      await prisma.notification.createMany({
        data: targets.map((u) => ({
          targetUserId: u.id,
          sentById: req.user.id,
          type: 'INFO',
          title: 'Attendance submitted',
          message: msg,
        })),
      });
    } catch (notifyErr) {
      console.warn('Attendance submit notify failed:', notifyErr?.message);
    }

    res.status(201).json({ ok: true, submission });
  } catch (error) {
    console.error('Attendance submit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
