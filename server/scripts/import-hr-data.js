// One-shot importer for the HR module — seeds Employees, Skill Matrix,
// the FY 2023-24 Training Plan, and the autoclave-batch training sessions.
//
// Reads from scripts/hr-data.json (pre-extracted from the original Excel
// files on the dev machine — see the sibling extract-hr-data.js script).
//
// Run from the server folder:   node scripts/import-hr-data.js
//
// Re-runnable: keyed on empCode / fiscalYear+serialNo / (subject + trainingDateFrom).

const fs = require('fs');
const path = require('path');
const prisma = require('../src/config/db');

const DATA_PATH = path.join(__dirname, 'hr-data.json');

// Skill columns in the order they appear in the source spreadsheet.
const SKILL_COLS = [
  'qmsAwareness',          'risksOpportunities',    'processKnowledge',
  'inspectionTesting',     'qualityAnalytical',     'nonconformityAnalysis',
  'customerRelations',     'supplierManagement',    'projectPlanning',
  'equipmentMaintenance',  'materialInventory',     'internalAuditing',
  'crisisManagement',      'communicationSkills',   'interPersonalRelations',
];

const sanitizeRating = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string' && /^n\.?a\.?$/i.test(v.trim())) return null;
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0;
  if (n > 4) return 4;
  return n;
};

const parseDmy = (s) => {
  if (!s) return null;
  const m = String(s).match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (!m) return null;
  let [, d, mo, y] = m;
  if (y.length === 2) y = '20' + y;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d));
  return Number.isNaN(dt.getTime()) ? null : dt;
};

// ─── 1. EMPLOYEES + SKILL MATRIX ────────────────────────────────────────────
async function importEmployeesAndSkills(data, systemUserId) {
  let created = 0, updated = 0, skillRows = 0;
  for (const e of data.employees) {
    const empCode = e.empCode;
    const skillData = {};
    for (let i = 0; i < SKILL_COLS.length; i++) {
      skillData[SKILL_COLS[i]] = sanitizeRating(e.skills?.[i]);
    }
    skillData.trainingNeeds = e.trainingNeeds;

    const existing = await prisma.employee.findUnique({ where: { empCode } });
    let employee;
    if (existing) {
      employee = await prisma.employee.update({
        where: { id: existing.id },
        data: {
          serialNo: e.serialNo,
          name: e.name,
          designation: e.designation,
          qualification: e.qualification,
          experience: e.experience,
          department: e.department,
          category: e.department,
          status: 'ACTIVE',
        },
      });
      updated++;
    } else {
      employee = await prisma.employee.create({
        data: {
          empCode,
          serialNo: e.serialNo,
          name: e.name,
          designation: e.designation,
          qualification: e.qualification,
          experience: e.experience,
          department: e.department,
          category: e.department,
          status: 'ACTIVE',
          createdById: systemUserId,
        },
      });
      created++;
    }

    await prisma.skillMatrix.upsert({
      where:  { employeeId: employee.id },
      create: { employeeId: employee.id, ...skillData },
      update: skillData,
    });
    skillRows++;
  }
  console.log(`Employees: ${created} created, ${updated} updated.`);
  console.log(`Skill matrix rows: ${skillRows}`);
}

// ─── 2. TRAINING PLAN FY 2023-24 + ITEMS ─────────────────────────────────────
async function importTrainingPlan(data, systemUserId) {
  const fy = '2023-24';
  let plan = await prisma.trainingPlan.findUnique({ where: { fiscalYear: fy } });
  if (!plan) {
    plan = await prisma.trainingPlan.create({
      data: {
        fiscalYear: fy,
        title: 'Annual Training Plan FY 2023-24',
        reference: 'RAMS/ATP/00, Dt. 10-11-2023',
        status: 'ACTIVE',
        createdById: systemUserId,
      },
    });
    console.log(`Training plan FY ${fy} created.`);
  } else {
    console.log(`Training plan FY ${fy} already exists — items will be added if missing.`);
  }

  let added = 0, skippedDup = 0;
  for (const item of data.planItems) {
    const dup = await prisma.trainingPlanItem.findFirst({
      where: { planId: plan.id, serialNo: item.serialNo },
    });
    if (dup) { skippedDup++; continue; }
    await prisma.trainingPlanItem.create({
      data: {
        planId: plan.id,
        serialNo: item.serialNo,
        subject: item.subject,
        participants: item.participants || '—',
        faculty: item.faculty,
        scheduledMonth: item.scheduledMonth,
        actualMonth: item.actualMonth,
        hoursPerMonth: item.hoursPerMonth,
        status: 'PLANNED',
        createdById: systemUserId,
      },
    });
    added++;
  }
  console.log(`Plan items: ${added} added, ${skippedDup} already present.`);
}

// ─── 3. TRAINING SESSIONS ────────────────────────────────────────────────────
async function importTrainingSessions(data, systemUserId) {
  const allEmps = await prisma.employee.findMany({ select: { id: true, name: true, empCode: true } });
  const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  const byName = new Map(allEmps.map((e) => [normalize(e.name), e]));

  // Loose match: exact normalized first, otherwise substring (min 5 chars).
  const matchEmployee = (raw) => {
    const norm = normalize(raw);
    if (!norm) return null;
    if (byName.has(norm)) return byName.get(norm);
    for (const [key, emp] of byName) {
      if ((key.includes(norm) || norm.includes(key)) && Math.min(key.length, norm.length) >= 5) {
        return emp;
      }
    }
    return null;
  };

  let sessionsCreated = 0, sessionsSkipped = 0, attendeesAdded = 0;
  const yearCounters = {};
  const nextSessionNumber = async (yr) => {
    if (yearCounters[yr] === undefined) {
      const top = await prisma.trainingSession.findMany({
        where: { sessionNumber: { startsWith: `TS-${yr}-` } },
        orderBy: { sessionNumber: 'desc' },
        take: 1,
        select: { sessionNumber: true },
      });
      yearCounters[yr] = top.length ? parseInt(top[0].sessionNumber.match(/(\d+)$/)[1], 10) : 0;
    }
    yearCounters[yr]++;
    return `TS-${yr}-${String(yearCounters[yr]).padStart(4, '0')}`;
  };

  for (const s of data.sessions) {
    const fromDate = parseDmy(s.fromDate);
    if (!s.subject || !fromDate || !s.faculty) {
      console.log(`  ! ${s.sheetName}: missing subject/from-date/faculty — skipped`);
      continue;
    }
    const existing = await prisma.trainingSession.findFirst({
      where: { subject: s.subject, trainingDateFrom: fromDate },
    });
    if (existing) { sessionsSkipped++; continue; }

    const yr = fromDate.getFullYear();
    const sessionNumber = await nextSessionNumber(yr);

    const matched = s.attendees.map((a) => ({ ...a, emp: matchEmployee(a.name) }));
    const matchedEmps = matched.filter((a) => a.emp);
    const unmatchedNames = matched.filter((a) => !a.emp).map((a) => a.name);

    await prisma.trainingSession.create({
      data: {
        sessionNumber,
        subject: s.subject,
        trainingDateFrom: fromDate,
        trainingDateTo: parseDmy(s.toDate),
        duration: s.duration,
        place: s.place,
        faculty: s.faculty,
        notes: unmatchedNames.length
          ? `Imported from ${s.sheetName}. Unmatched attendees (no Employee record): ${unmatchedNames.join('; ')}`
          : `Imported from ${s.sheetName}.`,
        createdById: systemUserId,
        attendees: matchedEmps.length
          ? {
              create: matchedEmps.map((a) => ({
                employeeId: a.emp.id,
                evaluationDetails: a.evalDetails,
                dateOfEvaluation: parseDmy(a.dateOfEval),
                evaluatedBy: a.evaluatedBy,
              })),
            }
          : undefined,
      },
    });
    sessionsCreated++;
    attendeesAdded += matchedEmps.length;
    if (unmatchedNames.length) {
      console.log(`  ! ${s.sheetName}: ${unmatchedNames.length} attendee(s) unmatched: ${unmatchedNames.join('; ')}`);
    }
  }
  console.log(`Training sessions: ${sessionsCreated} created, ${sessionsSkipped} already present.`);
  console.log(`Attendees added: ${attendeesAdded}`);
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
(async () => {
  if (!fs.existsSync(DATA_PATH)) {
    console.error(`Data file not found: ${DATA_PATH}`);
    console.error('Run scripts/extract-hr-data.js on a machine with the original Excel files first.');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));

  const owner = await prisma.user.findFirst({
    where: { role: { in: ['SUPERADMIN', 'ADMIN', 'HR'] }, isActive: true },
    orderBy: { createdAt: 'asc' },
  }) || await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!owner) {
    console.error('No users exist — create at least one admin before running this import.');
    process.exit(1);
  }
  console.log(`Crediting records to user: ${owner.username} (${owner.role})`);

  console.log('\n── 1. Employees + Skill Matrix ──');
  await importEmployeesAndSkills(data, owner.id);

  console.log('\n── 2. Training Plan FY 2023-24 ──');
  await importTrainingPlan(data, owner.id);

  console.log('\n── 3. Training Sessions ──');
  await importTrainingSessions(data, owner.id);

  console.log('\nDone.');
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
