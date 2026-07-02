// ──────────────────────────────────────────────────────────────
// Machine Allocation / Occupation
//
// Unit managers schedule Work Order or ION (Inter-Office Note) work onto a
// specific machine for a time window on a given day. Powers:
//   • the daily timeline calendar (per machine, 09:00–19:00 working window),
//   • the monthly utilisation KPI (busy / idle / maintenance / down),
//   • the auto-generated per-machine monthly report.
//
// Access model (unit-scoped):
//   • View: MANAGER, ADMIN, PLANNING, SUPERADMIN, SAFETY see every unit's board.
//   • Allocate / edit / delete: a MANAGER may only touch machines that sit in
//     their own unit (matched via the machine's `place`, e.g. a Unit-5 manager
//     edits "Unit-5" machines and sees the rest read-only). SUPERADMIN edits all.
// LAB / METROLOGY / NDT do not use this — machining allocation is a unit-manager
// concern only.
//
// Allocating a manager-assigned ION auto-advances it to WAITING (= "In Progress"),
// and a manager-assigned ION cannot be started without a machine allocated.
// ──────────────────────────────────────────────────────────────
const express = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');

const router = express.Router();

const VIEW_ROLES = ['MANAGER', 'ADMIN', 'PLANNING', 'SUPERADMIN', 'SAFETY'];

// Working window: 09:00–19:00 = 600 minutes/day.
const WORK_START_MIN = 9 * 60;   // 540
const WORK_END_MIN = 19 * 60;    // 1140
const WORK_DAY_MIN = WORK_END_MIN - WORK_START_MIN; // 600

const canAllocate = (user) => !!user && (user.role === 'MANAGER' || user.role === 'SUPERADMIN');

// ── Unit scoping ──────────────────────────────────────────────
// Machines carry a free-text `place` ("Unit-5", "Unit-1A", "Unit-2 QC Lab",
// "Unit-1 (NDT)"). Reduce it to a comparable unit key so allocation can be
// scoped per unit: a MANAGER only allocates/edits machines in their own unit,
// everyone else (incl. other-unit managers) sees them read-only. SUPERADMIN
// edits every unit.
const unitKeyFromLabel = (label) => {
  const m = /unit[\s\-_]*([0-9]+[a-z]?)/i.exec(label || '');
  return m ? m[1].toUpperCase() : null;
};

// The unit key of the logged-in user (prefers the unit code, e.g. "5" / "1A").
const userUnitKey = (user) => {
  const code = (user?.unit?.code || '').toString().trim().toUpperCase();
  if (code) return code;
  return unitKeyFromLabel(user?.unit?.name || user?.username || '');
};

// Can this user allocate / edit work on a machine sitting in `place`?
const canEditMachine = (user, place) => {
  if (!user) return false;
  if (user.role === 'SUPERADMIN') return true;
  if (user.role !== 'MANAGER') return false;
  const uk = userUnitKey(user);
  const pk = unitKeyFromLabel(place);
  return !!uk && !!pk && uk === pk;
};

const USER_SEL = { select: { id: true, name: true, role: true, unit: { select: { id: true, name: true, code: true } } } };

const ALLOC_INCLUDE = {
  machinery:   { select: { id: true, name: true, rapsId: true, place: true } },
  workOrder:   { select: { id: true, workOrderNumber: true, customerName: true, supplyOrderNo: true, pdcDate: true } },
  ion:         { select: { id: true, ionNumber: true, projectName: true, status: true } },
  allocatedBy: USER_SEL,
  unit:        { select: { id: true, name: true, code: true } },
};

// Parse "YYYY-MM-DD" → Date at local midnight. Falls back to today.
const dayStart = (s) => {
  const d = s ? new Date(`${s}T00:00:00`) : new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
const nextDay = (d) => { const n = new Date(d); n.setDate(n.getDate() + 1); return n; };

// Compose a full timestamp from a day + "HH:MM".
const atTime = (day, hhmm) => {
  const [h, m] = String(hhmm || '').split(':').map((x) => parseInt(x, 10));
  const d = new Date(day);
  d.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
  return d;
};

const minutesOfDay = (dt) => new Date(dt).getHours() * 60 + new Date(dt).getMinutes();

// Overlap of [aStart,aEnd) with the working window, in minutes (clamped ≥ 0).
const workingMinutes = (startAt, endAt) => {
  const s = Math.max(WORK_START_MIN, minutesOfDay(startAt));
  const e = Math.min(WORK_END_MIN, minutesOfDay(endAt));
  return Math.max(0, e - s);
};

// ── GET /api/machine-allocations/permissions ──
router.get('/permissions', authenticate, (req, res) => {
  res.json({ canAllocate: canAllocate(req.user) });
});

// ── GET /api/machine-allocations/allocatable ──
// Work Orders + IONs the current manager can put on a machine.
router.get('/allocatable', authenticate, authorize(...VIEW_ROLES), async (req, res) => {
  try {
    const isMgr = req.user.role === 'MANAGER';

    const workOrders = await prisma.workOrder.findMany({
      where: {
        status: { in: ['UNIT_ACCEPTED', 'IN_PROGRESS'] },
        ...(isMgr ? { assignedUnitId: req.user.unitId } : {}),
      },
      select: { id: true, workOrderNumber: true, customerName: true, supplyOrderNo: true, pdcDate: true, assignedUnitId: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    // IONs assigned to this manager (cross-unit machining), still open.
    const ions = await prisma.interOfficeNote.findMany({
      where: {
        status: { in: ['SENT', 'WAITING'] },
        ...(isMgr ? { assignedToId: req.user.id } : {}),
      },
      select: { id: true, ionNumber: true, projectName: true, status: true, supplyOrderNo: true, requiredByDate: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    res.json({ workOrders, ions });
  } catch (error) {
    console.error('List allocatable error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/machine-allocations/day?date=YYYY-MM-DD ──
// Machines + their allocations + downtime blocks for one calendar day.
router.get('/day', authenticate, authorize(...VIEW_ROLES), async (req, res) => {
  try {
    const from = dayStart(req.query.date);
    const to = nextDay(from);

    const [machines, allocations, downtimes] = await Promise.all([
      prisma.machinery.findMany({
        orderBy: [{ serialNumber: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, name: true, rapsId: true, place: true },
      }),
      prisma.machineAllocation.findMany({
        where: { scheduledDate: { gte: from, lt: to }, status: { not: 'CANCELLED' } },
        include: ALLOC_INCLUDE,
        orderBy: { startAt: 'asc' },
      }),
      prisma.machineDowntime.findMany({
        where: { scheduledDate: { gte: from, lt: to } },
        include: { machinery: { select: { id: true, name: true } }, createdBy: USER_SEL },
        orderBy: { startAt: 'asc' },
      }),
    ]);

    const myUnitKey = userUnitKey(req.user);
    // Tag each machine with its unit + whether this user may edit it, and sort
    // so the user's own unit comes first (then by unit key, then serial).
    const taggedMachines = machines
      .map((m) => ({
        ...m,
        unitKey: unitKeyFromLabel(m.place),
        canEdit: canEditMachine(req.user, m.place),
      }))
      .sort((a, b) => {
        const aMine = a.unitKey && a.unitKey === myUnitKey ? 0 : 1;
        const bMine = b.unitKey && b.unitKey === myUnitKey ? 0 : 1;
        if (aMine !== bMine) return aMine - bMine;
        const ak = a.unitKey || '~'; const bk = b.unitKey || '~';
        if (ak !== bk) return ak.localeCompare(bk, undefined, { numeric: true });
        return 0;
      });

    res.json({
      date: from.toISOString().slice(0, 10),
      workingWindow: { startMin: WORK_START_MIN, endMin: WORK_END_MIN },
      machines: taggedMachines,
      allocations,
      downtimes,
      myUnitKey,
      // "Can this user allocate anything?" — true only if they own an editable machine.
      canAllocate: taggedMachines.some((m) => m.canEdit),
    });
  } catch (error) {
    console.error('Allocation day feed error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reject a new/updated block that overlaps an existing one on the same machine.
const findOverlap = async (machineryId, startAt, endAt, excludeId) => {
  const from = new Date(startAt); from.setHours(0, 0, 0, 0);
  const to = nextDay(from);
  const sameDay = await prisma.machineAllocation.findMany({
    where: {
      machineryId,
      status: { not: 'CANCELLED' },
      scheduledDate: { gte: from, lt: to },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, startAt: true, endAt: true },
  });
  return sameDay.find((a) => new Date(startAt) < new Date(a.endAt) && new Date(endAt) > new Date(a.startAt));
};

// ── POST /api/machine-allocations ── create allocation
router.post('/', authenticate, async (req, res) => {
  try {
    if (!canAllocate(req.user)) return res.status(403).json({ error: 'Only unit managers can allocate machines' });

    const { machineryId, sourceType, workOrderId, ionId, date, startTime, endTime, title, workNote } = req.body || {};
    if (!machineryId) return res.status(400).json({ error: 'Select a machine' });
    if (!['WORK_ORDER', 'ION'].includes(sourceType)) return res.status(400).json({ error: 'Invalid source type' });
    if (!date || !startTime || !endTime) return res.status(400).json({ error: 'Date, start and end time are required' });

    const machine = await prisma.machinery.findUnique({ where: { id: machineryId } });
    if (!machine) return res.status(400).json({ error: 'Machine not found' });
    if (!canEditMachine(req.user, machine.place)) {
      return res.status(403).json({ error: 'You can only allocate machines in your own unit' });
    }

    const day = dayStart(date);
    const startAt = atTime(day, startTime);
    const endAt = atTime(day, endTime);
    if (endAt <= startAt) return res.status(400).json({ error: 'End time must be after start time' });

    let resolvedWorkOrderId = null;
    let resolvedIonId = null;
    let ion = null;

    if (sourceType === 'WORK_ORDER') {
      if (!workOrderId) return res.status(400).json({ error: 'Select a work order' });
      const wo = await prisma.workOrder.findUnique({ where: { id: workOrderId } });
      if (!wo) return res.status(400).json({ error: 'Work order not found' });
      resolvedWorkOrderId = wo.id;
    } else {
      if (!ionId) return res.status(400).json({ error: 'Select an ION' });
      ion = await prisma.interOfficeNote.findUnique({ where: { id: ionId } });
      if (!ion) return res.status(400).json({ error: 'ION not found' });
      if (req.user.role === 'MANAGER' && ion.assignedToId !== req.user.id) {
        return res.status(403).json({ error: 'This ION is not assigned to you' });
      }
      resolvedIonId = ion.id;
    }

    const clash = await findOverlap(machineryId, startAt, endAt, null);
    if (clash) return res.status(409).json({ error: 'This machine is already allocated during that time slot' });

    const created = await prisma.$transaction(async (tx) => {
      const alloc = await tx.machineAllocation.create({
        data: {
          machineryId,
          sourceType,
          workOrderId: resolvedWorkOrderId,
          ionId: resolvedIonId,
          title: title?.trim() || null,
          scheduledDate: day,
          startAt,
          endAt,
          status: 'SCHEDULED',
          workNote: workNote?.trim() || null,
          unitId: req.user.unitId || null,
          allocatedById: req.user.id,
        },
        include: ALLOC_INCLUDE,
      });

      // Allocating a manager-assigned ION starts it (SENT → WAITING = In Progress).
      if (resolvedIonId && ion && ion.status === 'SENT') {
        await tx.interOfficeNote.update({ where: { id: resolvedIonId }, data: { status: 'WAITING' } });
      }
      return alloc;
    });

    if (resolvedIonId && ion?.createdById && ion.createdById !== req.user.id) {
      await prisma.notification.create({
        data: {
          type: 'ION_RECEIVED',
          title: `ION ${ion.ionNumber}: Machine allocated`,
          message: `${req.user.name} allocated machine ${machine.name} (${machine.rapsId}) and started work on ION ${ion.ionNumber}.`,
          targetUserId: ion.createdById,
          sentById: req.user.id,
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'MACHINE_ALLOCATE',
        entity: 'MachineAllocation',
        entityId: created.id,
        details: { machine: machine.name, sourceType, workOrderId: resolvedWorkOrderId, ionId: resolvedIonId },
        ipAddress: req.ip,
      },
    });

    res.status(201).json(created);
  } catch (error) {
    console.error('Create allocation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /api/machine-allocations/:id ── edit times / status / note
router.put('/:id', authenticate, async (req, res) => {
  try {
    if (!canAllocate(req.user)) return res.status(403).json({ error: 'Only unit managers can edit allocations' });

    const existing = await prisma.machineAllocation.findUnique({
      where: { id: req.params.id },
      include: { machinery: { select: { place: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'Allocation not found' });
    if (!canEditMachine(req.user, existing.machinery?.place)) {
      return res.status(403).json({ error: 'You can only edit allocations for machines in your own unit' });
    }

    const { date, startTime, endTime, status, workNote, title } = req.body || {};
    const data = {};

    if (date || startTime || endTime) {
      const day = date ? dayStart(date) : new Date(existing.scheduledDate);
      const startAt = startTime ? atTime(day, startTime) : new Date(existing.startAt);
      const endAt = endTime ? atTime(day, endTime) : new Date(existing.endAt);
      if (endAt <= startAt) return res.status(400).json({ error: 'End time must be after start time' });
      const clash = await findOverlap(existing.machineryId, startAt, endAt, existing.id);
      if (clash) return res.status(409).json({ error: 'This machine is already allocated during that time slot' });
      data.scheduledDate = day;
      data.startAt = startAt;
      data.endAt = endAt;
    }
    if (status && ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(status)) data.status = status;
    if (workNote !== undefined) data.workNote = workNote?.trim() || null;
    if (title !== undefined) data.title = title?.trim() || null;

    const updated = await prisma.machineAllocation.update({
      where: { id: req.params.id },
      data,
      include: ALLOC_INCLUDE,
    });
    res.json(updated);
  } catch (error) {
    console.error('Update allocation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/machine-allocations/:id ──
router.delete('/:id', authenticate, async (req, res) => {
  try {
    if (!canAllocate(req.user)) return res.status(403).json({ error: 'Only unit managers can delete allocations' });
    const existing = await prisma.machineAllocation.findUnique({
      where: { id: req.params.id },
      include: { machinery: { select: { place: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'Allocation not found' });
    if (!canEditMachine(req.user, existing.machinery?.place)) {
      return res.status(403).json({ error: 'You can only delete allocations for machines in your own unit' });
    }
    await prisma.machineAllocation.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (error) {
    console.error('Delete allocation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/machine-allocations/downtime ── log maintenance / breakdown
router.post('/downtime', authenticate, async (req, res) => {
  try {
    if (!canAllocate(req.user)) return res.status(403).json({ error: 'Only unit managers can log downtime' });
    const { machineryId, date, startTime, endTime, reason, note } = req.body || {};
    if (!machineryId || !date || !startTime || !endTime) {
      return res.status(400).json({ error: 'Machine, date, start and end time are required' });
    }
    const machine = await prisma.machinery.findUnique({ where: { id: machineryId } });
    if (!machine) return res.status(400).json({ error: 'Machine not found' });
    if (!canEditMachine(req.user, machine.place)) {
      return res.status(403).json({ error: 'You can only log downtime for machines in your own unit' });
    }

    const day = dayStart(date);
    const startAt = atTime(day, startTime);
    const endAt = atTime(day, endTime);
    if (endAt <= startAt) return res.status(400).json({ error: 'End time must be after start time' });

    const created = await prisma.machineDowntime.create({
      data: {
        machineryId,
        scheduledDate: day,
        startAt,
        endAt,
        reason: ['MAINTENANCE', 'BREAKDOWN', 'OTHER'].includes(reason) ? reason : 'MAINTENANCE',
        note: note?.trim() || null,
        unitId: req.user.unitId || null,
        createdById: req.user.id,
      },
      include: { machinery: { select: { id: true, name: true } }, createdBy: USER_SEL },
    });
    res.status(201).json(created);
  } catch (error) {
    console.error('Create downtime error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/machine-allocations/downtime/:id ──
router.delete('/downtime/:id', authenticate, async (req, res) => {
  try {
    if (!canAllocate(req.user)) return res.status(403).json({ error: 'Only unit managers can delete downtime' });
    const existing = await prisma.machineDowntime.findUnique({
      where: { id: req.params.id },
      include: { machinery: { select: { place: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'Downtime not found' });
    if (!canEditMachine(req.user, existing.machinery?.place)) {
      return res.status(403).json({ error: 'You can only delete downtime for machines in your own unit' });
    }
    await prisma.machineDowntime.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (error) {
    console.error('Delete downtime error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Month range helpers. month = "YYYY-MM".
const monthRange = (month) => {
  const now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth();
  if (/^\d{4}-\d{2}$/.test(month || '')) {
    const [yy, mm] = month.split('-').map((x) => parseInt(x, 10));
    y = yy; m = mm - 1;
  }
  const from = new Date(y, m, 1);
  const to = new Date(y, m + 1, 1);
  return { from, to, label: `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}` };
};

// Working days in a month = all days except Sundays (Mon–Sat factory week).
const workingDaysInMonth = (from, to) => {
  let count = 0;
  const d = new Date(from);
  while (d < to) {
    if (d.getDay() !== 0) count += 1; // 0 = Sunday
    d.setDate(d.getDate() + 1);
  }
  return count;
};

const round1 = (n) => Math.round(n * 10) / 10;

// Compute per-machine utilisation for a month.
const computeKpi = async (from, to) => {
  const [machines, allocations, downtimes] = await Promise.all([
    prisma.machinery.findMany({
      orderBy: [{ serialNumber: 'asc' }],
      select: { id: true, name: true, rapsId: true, place: true },
    }),
    prisma.machineAllocation.findMany({
      where: { scheduledDate: { gte: from, lt: to }, status: { not: 'CANCELLED' } },
      select: { machineryId: true, startAt: true, endAt: true },
    }),
    prisma.machineDowntime.findMany({
      where: { scheduledDate: { gte: from, lt: to } },
      select: { machineryId: true, startAt: true, endAt: true, reason: true },
    }),
  ]);

  const wDays = workingDaysInMonth(from, to);
  const availablePerMachine = wDays * WORK_DAY_MIN;

  const busyByMachine = new Map();
  for (const a of allocations) {
    busyByMachine.set(a.machineryId, (busyByMachine.get(a.machineryId) || 0) + workingMinutes(a.startAt, a.endAt));
  }
  const downByMachine = new Map();
  const maintByMachine = new Map();
  for (const d of downtimes) {
    const mins = workingMinutes(d.startAt, d.endAt);
    downByMachine.set(d.machineryId, (downByMachine.get(d.machineryId) || 0) + mins);
    if (d.reason === 'MAINTENANCE') {
      maintByMachine.set(d.machineryId, (maintByMachine.get(d.machineryId) || 0) + mins);
    }
  }

  const rows = machines.map((m) => {
    const busy = busyByMachine.get(m.id) || 0;
    const down = downByMachine.get(m.id) || 0;
    const maintenance = maintByMachine.get(m.id) || 0;
    const available = availablePerMachine;
    const idle = Math.max(0, available - busy - down);
    const utilization = available > 0 ? round1((busy / available) * 100) : 0;
    return {
      machineryId: m.id,
      name: m.name,
      rapsId: m.rapsId,
      place: m.place,
      availableMin: available,
      busyMin: busy,
      downMin: down,
      maintenanceMin: maintenance,
      idleMin: idle,
      utilizationPercent: utilization,
    };
  });

  const totBusy = rows.reduce((s, r) => s + r.busyMin, 0);
  const totAvail = rows.reduce((s, r) => s + r.availableMin, 0);

  return {
    workingDays: wDays,
    workDayMinutes: WORK_DAY_MIN,
    machineCount: machines.length,
    overallUtilizationPercent: totAvail > 0 ? round1((totBusy / totAvail) * 100) : 0,
    rows,
  };
};

// ── GET /api/machine-allocations/kpi?month=YYYY-MM ──
router.get('/kpi', authenticate, authorize(...VIEW_ROLES), async (req, res) => {
  try {
    const { from, to, label } = monthRange(req.query.month);
    const kpi = await computeKpi(from, to);
    res.json({ month: label, ...kpi });
  } catch (error) {
    console.error('Allocation KPI error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/machine-allocations/report?machineryId=&month=YYYY-MM ──
// Auto-generated monthly report for one machine (or all if machineryId omitted).
router.get('/report', authenticate, authorize(...VIEW_ROLES), async (req, res) => {
  try {
    const { from, to, label } = monthRange(req.query.month);
    const kpi = await computeKpi(from, to);

    const where = { scheduledDate: { gte: from, lt: to }, status: { not: 'CANCELLED' } };
    if (req.query.machineryId) where.machineryId = req.query.machineryId;

    const [allocations, downtimes] = await Promise.all([
      prisma.machineAllocation.findMany({ where, include: ALLOC_INCLUDE, orderBy: [{ machineryId: 'asc' }, { startAt: 'asc' }] }),
      prisma.machineDowntime.findMany({
        where: req.query.machineryId
          ? { scheduledDate: { gte: from, lt: to }, machineryId: req.query.machineryId }
          : { scheduledDate: { gte: from, lt: to } },
        include: { machinery: { select: { id: true, name: true } }, createdBy: USER_SEL },
        orderBy: { startAt: 'asc' },
      }),
    ]);

    const kpiRows = req.query.machineryId
      ? kpi.rows.filter((r) => r.machineryId === req.query.machineryId)
      : kpi.rows;

    res.json({
      month: label,
      workingDays: kpi.workingDays,
      workDayMinutes: kpi.workDayMinutes,
      generatedAt: new Date().toISOString(),
      kpi: kpiRows,
      allocations,
      downtimes,
    });
  } catch (error) {
    console.error('Allocation report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
