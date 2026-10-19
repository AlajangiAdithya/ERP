// ──────────────────────────────────────────────────────────────
// Working machine status - the daily ON/OFF log, one row per machine per day.
// Mirrors "WORKING MACHINE STATUS FILE.xlsx": work, ON person + time,
// OFF person + time, remarks.
//
// Access model:
//   • Read  - any authenticated user, any unit. Units need to see each other.
//   • Write - SUPERADMIN / ADMIN / SAFETY anywhere; everyone else only on
//             machines belonging to their own unit.
// This deliberately replaces the old blanket "anyone in Unit-5 edits
// everything" rule that machinery.routes.js still uses for the master register.
// ──────────────────────────────────────────────────────────────
const express = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { createWorkbook, exportFileName, sendWorkbook } = require('../utils/excel');

const router = express.Router();

const ANY_UNIT_ROLES = ['SUPERADMIN', 'ADMIN', 'SAFETY'];

// A machine with no resolved unit (no `place`, or a `place` that matched no
// Unit) is nobody's to edit except the roles that span every unit - otherwise
// an unassigned machine would be editable by everyone or by no one at random.
const canEditMachine = (user, machine) => {
  if (!user) return false;
  if (ANY_UNIT_ROLES.includes(user.role)) return true;
  if (!machine?.unitId || !user.unitId) return false;
  return machine.unitId === user.unitId;
};

// Minutes from midnight. Accepts "HH:mm" (what <input type="time"> gives) or a
// plain integer, so the client never has to do clock maths.
const toMinutes = (v) => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v === 'number') {
    return Number.isInteger(v) && v >= 0 && v <= 1439 ? v : NaN;
  }
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v).trim());
  if (!m) return NaN;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return NaN;
  return h * 60 + min;
};

// A shift that ends before it starts ran past midnight. Anything beyond that is
// a genuine overnight run, which the client flags but does not block.
const deriveRunMinutes = (onMinutes, offMinutes) => {
  if (onMinutes === null || onMinutes === undefined) return null;
  if (offMinutes === null || offMinutes === undefined) return null;
  return offMinutes >= onMinutes ? offMinutes - onMinutes : offMinutes - onMinutes + 1440;
};

const trimOrNull = (v) => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

// "2026-10" → { start: 2026-10-01, end: 2026-11-01, days: 31 }. Built in UTC so
// the month boundaries do not drift with the server's local offset; logDate is
// a DATE column with no time component.
const monthRange = (month) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || '').trim());
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const mon = parseInt(m[2], 10);
  if (mon < 1 || mon > 12) return null;
  const start = new Date(Date.UTC(year, mon - 1, 1));
  const end = new Date(Date.UTC(mon === 12 ? year + 1 : year, mon === 12 ? 0 : mon, 1));
  const days = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return { year, mon, start, end, days };
};

const ymd = (d) => new Date(d).toISOString().slice(0, 10);

// Hours run, days run, and the number of rows left open (an ON with no OFF).
// Open rows are counted separately rather than folded in as zero: a month
// reading "92 hours" is misleading if four days were never closed out.
const summarise = (rows) => {
  let runMinutes = 0;
  let daysRun = 0;
  let openRows = 0;
  rows.forEach((r) => {
    if (r.runMinutes && r.runMinutes > 0) {
      runMinutes += r.runMinutes;
      daysRun += 1;
    } else if (r.onMinutes !== null && r.onMinutes !== undefined && (r.offMinutes === null || r.offMinutes === undefined)) {
      openRows += 1;
    }
  });
  return {
    runMinutes,
    hours: Math.round((runMinutes / 60) * 10) / 10,
    daysRun,
    openRows,
    avgHoursPerRunDay: daysRun ? Math.round((runMinutes / daysRun / 60) * 10) / 10 : null,
  };
};

// ───────────────── Units overview ─────────────────
// Unit cards for the landing view: machine count + hours run this month, so a
// manager sees the number they came for before drilling in.
router.get('/units', authenticate, async (req, res) => {
  try {
    const range = monthRange(req.query.month) || monthRange(ymd(new Date()).slice(0, 7));

    const [units, machines, rows] = await Promise.all([
      prisma.unit.findMany({
        where: { isActive: true },
        select: { id: true, name: true, code: true },
        orderBy: { code: 'asc' },
      }),
      prisma.machinery.findMany({ select: { id: true, unitId: true } }),
      prisma.machineWorkStatus.findMany({
        where: { logDate: { gte: range.start, lt: range.end } },
        select: { unitId: true, runMinutes: true, onMinutes: true, offMinutes: true },
      }),
    ]);

    const byUnit = new Map();
    const bucket = (key) => {
      if (!byUnit.has(key)) byUnit.set(key, { machineCount: 0, rows: [] });
      return byUnit.get(key);
    };
    machines.forEach((m) => { bucket(m.unitId || 'unassigned').machineCount += 1; });
    rows.forEach((r) => { bucket(r.unitId || 'unassigned').rows.push(r); });

    const cards = units.map((u) => {
      const b = bucket(u.id);
      return {
        unitId: u.id,
        code: u.code,
        name: u.name,
        machineCount: b.machineCount,
        canEdit: ANY_UNIT_ROLES.includes(req.user.role) || req.user.unitId === u.id,
        ...summarise(b.rows),
      };
    });

    const un = bucket('unassigned');
    if (un.machineCount > 0) {
      cards.push({
        unitId: null,
        code: null,
        name: 'Unassigned',
        machineCount: un.machineCount,
        canEdit: ANY_UNIT_ROLES.includes(req.user.role),
        ...summarise(un.rows),
      });
    }

    res.json({ month: `${range.year}-${String(range.mon).padStart(2, '0')}`, units: cards });
  } catch (error) {
    console.error('Machine work status units error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ───────────────── Machine list ─────────────────
// Every machine, or one unit's. Drives both the unit drill-down and the
// searchable machine picker on the sheet, so it always carries canEdit.
router.get('/machines', authenticate, async (req, res) => {
  try {
    const { unitId } = req.query;
    const where = {};
    if (unitId === 'unassigned') where.unitId = null;
    else if (unitId) where.unitId = unitId;

    const range = monthRange(req.query.month) || monthRange(ymd(new Date()).slice(0, 7));

    const machines = await prisma.machinery.findMany({
      where,
      orderBy: [{ serialNumber: 'asc' }, { createdAt: 'asc' }],
      include: { unit: { select: { id: true, name: true, code: true } } },
    });

    const rows = machines.length
      ? await prisma.machineWorkStatus.findMany({
        where: {
          machineryId: { in: machines.map((m) => m.id) },
          logDate: { gte: range.start, lt: range.end },
        },
        select: { machineryId: true, runMinutes: true, onMinutes: true, offMinutes: true },
      })
      : [];

    const grouped = new Map();
    rows.forEach((r) => {
      if (!grouped.has(r.machineryId)) grouped.set(r.machineryId, []);
      grouped.get(r.machineryId).push(r);
    });

    res.json({
      month: `${range.year}-${String(range.mon).padStart(2, '0')}`,
      items: machines.map((m) => ({
        ...m,
        canEdit: canEditMachine(req.user, m),
        ...summarise(grouped.get(m.id) || []),
      })),
    });
  } catch (error) {
    console.error('Machine work status machines error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ───────────────── The sheet ─────────────────
// One machine, one month. Always returns every day of the month, whether a row
// exists or not, so the grid shape is stable and the client does no date maths.
router.get('/sheet', authenticate, async (req, res) => {
  try {
    const { machineryId } = req.query;
    if (!machineryId) return res.status(400).json({ error: 'machineryId is required' });

    const range = monthRange(req.query.month) || monthRange(ymd(new Date()).slice(0, 7));
    if (!range) return res.status(400).json({ error: 'month must be YYYY-MM' });

    const machine = await prisma.machinery.findUnique({
      where: { id: machineryId },
      include: { unit: { select: { id: true, name: true, code: true } } },
    });
    if (!machine) return res.status(404).json({ error: 'Machine not found' });

    const rows = await prisma.machineWorkStatus.findMany({
      where: { machineryId, logDate: { gte: range.start, lt: range.end } },
      orderBy: { logDate: 'asc' },
    });

    const byDate = new Map(rows.map((r) => [ymd(r.logDate), r]));
    const days = [];
    for (let d = 1; d <= range.days; d += 1) {
      const date = ymd(new Date(Date.UTC(range.year, range.mon - 1, d)));
      const row = byDate.get(date) || null;
      days.push({
        serial: d,
        logDate: date,
        work: row?.work ?? null,
        onPerson: row?.onPerson ?? null,
        offPerson: row?.offPerson ?? null,
        onMinutes: row?.onMinutes ?? null,
        offMinutes: row?.offMinutes ?? null,
        runMinutes: row?.runMinutes ?? null,
        remarks: row?.remarks ?? null,
      });
    }

    res.json({
      machine,
      month: `${range.year}-${String(range.mon).padStart(2, '0')}`,
      canEdit: canEditMachine(req.user, machine),
      days,
      stats: summarise(rows),
    });
  } catch (error) {
    console.error('Machine work status sheet error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ───────────────── Year roll-up ─────────────────
// Twelve months for one machine, always all twelve. A month with no rows comes
// back with hasData:false rather than zeroes - "nothing recorded" and "ran for
// zero hours" are different facts and an audit has to tell them apart.
router.get('/year', authenticate, async (req, res) => {
  try {
    const { machineryId } = req.query;
    if (!machineryId) return res.status(400).json({ error: 'machineryId is required' });

    const year = parseInt(req.query.year, 10) || new Date().getUTCFullYear();

    const machine = await prisma.machinery.findUnique({
      where: { id: machineryId },
      include: { unit: { select: { id: true, name: true, code: true } } },
    });
    if (!machine) return res.status(404).json({ error: 'Machine not found' });

    const rows = await prisma.machineWorkStatus.findMany({
      where: {
        machineryId,
        logDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
      },
      select: { logDate: true, runMinutes: true, onMinutes: true, offMinutes: true },
    });

    const buckets = Array.from({ length: 12 }, () => []);
    rows.forEach((r) => { buckets[new Date(r.logDate).getUTCMonth()].push(r); });

    const months = buckets.map((b, i) => ({
      month: `${year}-${String(i + 1).padStart(2, '0')}`,
      monthIndex: i + 1,
      hasData: b.length > 0,
      ...summarise(b),
    }));

    // Years the machine has any data in, so the picker can disable dead arrows
    // instead of letting someone page through empty decades.
    const bounds = await prisma.machineWorkStatus.aggregate({
      where: { machineryId },
      _min: { logDate: true },
      _max: { logDate: true },
    });

    res.json({
      machine,
      year,
      canEdit: canEditMachine(req.user, machine),
      months,
      yearTotal: summarise(rows),
      dataFrom: bounds._min.logDate ? new Date(bounds._min.logDate).getUTCFullYear() : null,
      dataTo: bounds._max.logDate ? new Date(bounds._max.logDate).getUTCFullYear() : null,
    });
  } catch (error) {
    console.error('Machine work status year error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ───────────────── Save a day ─────────────────
// Upserts on (machineryId, logDate) so a double submit cannot create two rows
// for one day. Only the fields present in the body are touched, which lets the
// grid save a single cell without shipping the whole row back.
router.post('/upsert', authenticate, async (req, res) => {
  try {
    const body = req.body || {};
    const { machineryId } = body;
    if (!machineryId) return res.status(400).json({ error: 'machineryId is required' });

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.logDate || ''))) {
      return res.status(400).json({ error: 'logDate must be YYYY-MM-DD' });
    }
    const logDate = new Date(`${body.logDate}T00:00:00.000Z`);
    if (Number.isNaN(logDate.getTime())) return res.status(400).json({ error: 'logDate is invalid' });

    const machine = await prisma.machinery.findUnique({
      where: { id: machineryId },
      select: { id: true, name: true, unitId: true },
    });
    if (!machine) return res.status(404).json({ error: 'Machine not found' });

    if (!canEditMachine(req.user, machine)) {
      return res.status(403).json({ error: 'You can only edit machines in your own unit' });
    }

    const onMinutes = toMinutes(body.onTime !== undefined ? body.onTime : body.onMinutes);
    const offMinutes = toMinutes(body.offTime !== undefined ? body.offTime : body.offMinutes);
    if (Number.isNaN(onMinutes)) return res.status(400).json({ error: 'ON time must be HH:mm' });
    if (Number.isNaN(offMinutes)) return res.status(400).json({ error: 'OFF time must be HH:mm' });

    const existing = await prisma.machineWorkStatus.findUnique({
      where: { machineryId_logDate: { machineryId, logDate } },
    });

    // runMinutes is derived from whichever ends are in play once this write
    // lands - the submitted value if given, else what is already stored.
    const nextOn = onMinutes === undefined ? (existing?.onMinutes ?? null) : onMinutes;
    const nextOff = offMinutes === undefined ? (existing?.offMinutes ?? null) : offMinutes;

    const fields = {};
    if (body.work !== undefined) fields.work = trimOrNull(body.work);
    if (body.onPerson !== undefined) fields.onPerson = trimOrNull(body.onPerson);
    if (body.offPerson !== undefined) fields.offPerson = trimOrNull(body.offPerson);
    if (body.remarks !== undefined) fields.remarks = trimOrNull(body.remarks);
    if (onMinutes !== undefined) fields.onMinutes = onMinutes;
    if (offMinutes !== undefined) fields.offMinutes = offMinutes;

    const row = await prisma.machineWorkStatus.upsert({
      where: { machineryId_logDate: { machineryId, logDate } },
      create: {
        machineryId,
        unitId: machine.unitId,
        logDate,
        ...fields,
        runMinutes: deriveRunMinutes(nextOn, nextOff),
        createdById: req.user.id,
        updatedById: req.user.id,
      },
      update: {
        ...fields,
        // Keep the denormalised unit honest if the machine has been reassigned
        // since this row was first written.
        unitId: machine.unitId,
        runMinutes: deriveRunMinutes(nextOn, nextOff),
        updatedById: req.user.id,
      },
    });

    res.json(row);
  } catch (error) {
    console.error('Machine work status upsert error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ───────────────── Excel export ─────────────────
// Rebuilds the sheet in the exact shape of "WORKING MACHINE STATUS FILE.xlsx" -
// merged title row, merged machine row, the eight columns, a row per day, and
// the merged footer strip the printed form signs off on. Staff still circulate
// this file, so the export has to be the same document, not a generic dump.
const MONTH_NAMES = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY',
  'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

const hhmm = (mins) => (mins === null || mins === undefined
  ? ''
  : `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`);

const SHEET_COLUMNS = [
  { header: 'S.No', width: 6 },
  { header: 'DATE', width: 12 },
  { header: 'work', width: 30 },
  { header: 'MC Operator /\nON Person', width: 18 },
  { header: 'ON Time', width: 10 },
  { header: 'MC Operator /\nOFF Person', width: 18 },
  { header: 'OFF Time', width: 10 },
  { header: 'Remarks/\nResult', width: 28 },
];

const THIN = { style: 'thin', color: { argb: 'FF9AA5B1' } };

router.get('/export', authenticate, async (req, res) => {
  try {
    const { machineryId } = req.query;
    if (!machineryId) return res.status(400).json({ error: 'machineryId is required' });

    const range = monthRange(req.query.month) || monthRange(ymd(new Date()).slice(0, 7));
    if (!range) return res.status(400).json({ error: 'month must be YYYY-MM' });

    const machine = await prisma.machinery.findUnique({
      where: { id: machineryId },
      include: { unit: { select: { name: true, code: true } } },
    });
    if (!machine) return res.status(404).json({ error: 'Machine not found' });

    const rows = await prisma.machineWorkStatus.findMany({
      where: { machineryId, logDate: { gte: range.start, lt: range.end } },
      orderBy: { logDate: 'asc' },
    });
    const byDate = new Map(rows.map((r) => [ymd(r.logDate), r]));

    const wb = createWorkbook();
    const ws = wb.addWorksheet('Work Status', {
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
    });

    ws.columns = SHEET_COLUMNS.map((c) => ({ width: c.width }));

    const unitLabel = machine.unit?.name
      ? machine.unit.name.toUpperCase()
      : (machine.place || 'UNASSIGNED').toUpperCase();

    ws.mergeCells('A1:H1');
    ws.getCell('A1').value = `WORK STATUS - ${unitLabel}  ${MONTH_NAMES[range.mon - 1]}-${range.year}`;
    ws.getCell('A1').font = { bold: true, size: 13 };
    ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 24;

    ws.mergeCells('A2:H2');
    ws.getCell('A2').value = `MACHINE NAME:  ${machine.name}      MACHINE ID:${machine.rapsId || ''}`;
    ws.getCell('A2').font = { bold: true, size: 11 };
    ws.getCell('A2').alignment = { horizontal: 'left', vertical: 'middle' };
    ws.getRow(2).height = 20;

    const head = ws.getRow(3);
    SHEET_COLUMNS.forEach((c, i) => {
      const cell = head.getCell(i + 1);
      cell.value = c.header.replace(/\n/g, '\n');
      cell.font = { bold: true, size: 10 };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FA' } };
    });
    head.height = 32;

    for (let d = 1; d <= range.days; d += 1) {
      const date = new Date(Date.UTC(range.year, range.mon - 1, d));
      const row = byDate.get(ymd(date));
      const r = ws.getRow(3 + d);
      r.getCell(1).value = d;
      r.getCell(2).value = date;
      r.getCell(2).numFmt = 'dd-mmm-yy';
      r.getCell(3).value = row?.work || '';
      r.getCell(4).value = row?.onPerson || '';
      r.getCell(5).value = hhmm(row?.onMinutes);
      r.getCell(6).value = row?.offPerson || '';
      r.getCell(7).value = hhmm(row?.offMinutes);
      r.getCell(8).value = row?.remarks || '';
      for (let c = 1; c <= 8; c += 1) {
        r.getCell(c).border = { top: THIN, left: THIN, bottom: THIN, right: THIN };
        r.getCell(c).alignment = {
          vertical: 'middle',
          horizontal: [1, 2, 5, 7].includes(c) ? 'center' : 'left',
          wrapText: c === 3 || c === 8,
        };
        r.getCell(c).font = { size: 10 };
      }
    }

    const footerRow = 4 + range.days;
    ws.mergeCells(`A${footerRow}:H${footerRow}`);
    ws.getRow(footerRow).height = 28;

    // The totals go below the signature strip so the form itself stays an exact
    // copy - anyone diffing it against the old file sees the same grid.
    const totalRow = ws.getRow(footerRow + 1);
    totalRow.getCell(1).value = 'TOTAL';
    totalRow.getCell(1).font = { bold: true, size: 10 };
    const s = summarise(rows);
    totalRow.getCell(3).value = `${s.hours} hours over ${s.daysRun} day(s)`
      + (s.openRows ? `  ·  ${s.openRows} row(s) with no OFF time` : '');
    totalRow.getCell(3).font = { bold: true, size: 10 };

    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 3 }];

    const base = `Work_Status_${machine.name}_${range.year}-${String(range.mon).padStart(2, '0')}`;
    await sendWorkbook(res, wb, exportFileName(base));
  } catch (error) {
    console.error('Machine work status export error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

// ───────────────── Clear a day ─────────────────
router.post('/clear', authenticate, async (req, res) => {
  try {
    const { machineryId, logDate } = req.body || {};
    if (!machineryId || !/^\d{4}-\d{2}-\d{2}$/.test(String(logDate || ''))) {
      return res.status(400).json({ error: 'machineryId and logDate (YYYY-MM-DD) are required' });
    }

    const machine = await prisma.machinery.findUnique({
      where: { id: machineryId },
      select: { id: true, name: true, unitId: true },
    });
    if (!machine) return res.status(404).json({ error: 'Machine not found' });
    if (!canEditMachine(req.user, machine)) {
      return res.status(403).json({ error: 'You can only edit machines in your own unit' });
    }

    await prisma.machineWorkStatus.deleteMany({
      where: { machineryId, logDate: new Date(`${logDate}T00:00:00.000Z`) },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'MACHINE_WORK_STATUS_CLEAR',
        entity: 'MachineWorkStatus',
        entityId: machineryId,
        details: { machine: machine.name, logDate },
        ipAddress: req.ip,
      },
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Machine work status clear error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

// Exported for tests. The clock and roll-up maths is the part of this file most
// worth pinning down, and it is all pure.
module.exports.__test = {
  canEditMachine, toMinutes, deriveRunMinutes, monthRange, summarise, hhmm,
};
