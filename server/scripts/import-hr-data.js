// One-shot importer for the HR module — seeds Employees, Skill Matrix,
// the FY 2023-24 Training Plan, and the autoclave-batch training sessions.
//
//   Sources:
//     • Skill matrix:    C:/Users/alaja/Downloads/Skill matrix_LATEST.xlsx (sheet "Skill matrix v1 (2)" — FY 26-27)
//     • Training plan:   C:/Users/alaja/Downloads/Training Plan_2023-24.xls
//     • Training records: C:/Users/alaja/Downloads/Training attendence-cum-evaluation record_Autoclave operation.xls
//
//   Run from the server folder:   node scripts/import-hr-data.js
//
//   Re-runnable: keyed on empCode / fiscalYear / (subject + trainingDateFrom) — no duplicates on second run.

const XLSX = require('xlsx');
const prisma = require('../src/config/db');

// Override with HR_SKILL_FILE / HR_PLAN_FILE / HR_REC_FILE env vars when
// running on a server where the Excel files live elsewhere.
const SKILL_FILE = process.env.HR_SKILL_FILE || 'C:/Users/alaja/Downloads/Skill matrix_LATEST.xlsx';
const PLAN_FILE  = process.env.HR_PLAN_FILE  || 'C:/Users/alaja/Downloads/Training Plan_2023-24.xls';
const REC_FILE   = process.env.HR_REC_FILE   || 'C:/Users/alaja/Downloads/Training attendence-cum-evaluation record_Autoclave operation.xls';

// Column order of the 15 skill ratings in the skill-matrix sheet (after
// columns A=code, B=serial, C=name, D=designation, E=qualification, F=experience).
const SKILL_COLS = [
  'qmsAwareness',          // G
  'risksOpportunities',    // H
  'processKnowledge',      // I
  'inspectionTesting',     // J
  'qualityAnalytical',     // K
  'nonconformityAnalysis', // L
  'customerRelations',     // M
  'supplierManagement',    // N
  'projectPlanning',       // O
  'equipmentMaintenance',  // P
  'materialInventory',     // Q
  'internalAuditing',      // R
  'crisisManagement',      // S
  'communicationSkills',   // T
  'interPersonalRelations',// U
];

const cleanText = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s ? s : null;
};

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
async function importEmployeesAndSkills(systemUserId) {
  const wb = XLSX.readFile(SKILL_FILE);
  const sheet = wb.Sheets['Skill matrix v1 (2)'];
  if (!sheet) throw new Error('Sheet "Skill matrix v1 (2)" not found.');
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  let created = 0, updated = 0, skipped = 0, skillRows = 0;
  for (const r of rows) {
    const code = cleanText(r[0]);
    const serial = parseInt(r[1], 10);
    const name = cleanText(r[2]);
    if (!code || !name || !Number.isFinite(serial)) { skipped++; continue; }
    if (!/^RAPSPL-?\d+/i.test(code)) { skipped++; continue; }

    const empCode = code.toUpperCase().replace(/\s+/g, '');
    const designation   = cleanText(r[3]);
    const qualification = cleanText(r[4]);
    const experience    = (() => {
      const n = parseInt(r[5], 10);
      return Number.isFinite(n) ? n : null;
    })();
    const trainingNeeds = cleanText(r[21]);
    const department    = cleanText(r[22]);

    const skillData = {};
    for (let i = 0; i < SKILL_COLS.length; i++) {
      skillData[SKILL_COLS[i]] = sanitizeRating(r[6 + i]);
    }
    skillData.trainingNeeds = trainingNeeds;

    const existing = await prisma.employee.findUnique({ where: { empCode } });
    let employee;
    if (existing) {
      employee = await prisma.employee.update({
        where: { id: existing.id },
        data: {
          serialNo: serial,
          name,
          designation,
          qualification,
          experience,
          department,
          // category mirrors department for now; can be refined manually.
          category: department,
          status: 'ACTIVE',
        },
      });
      updated++;
    } else {
      employee = await prisma.employee.create({
        data: {
          empCode,
          serialNo: serial,
          name,
          designation,
          qualification,
          experience,
          department,
          category: department,
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
  console.log(`Employees: ${created} created, ${updated} updated, ${skipped} skipped.`);
  console.log(`Skill matrix rows: ${skillRows}`);
}

// ─── 2. TRAINING PLAN FY 2023-24 + ITEMS ─────────────────────────────────────
async function importTrainingPlan(systemUserId) {
  const wb = XLSX.readFile(PLAN_FILE);
  const sheet = wb.Sheets['Training plan'];
  if (!sheet) throw new Error('Sheet "Training plan" not found.');
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

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
  for (const r of rows) {
    const sno = parseInt(r[0], 10);
    const subject = cleanText(r[1]);
    if (!Number.isFinite(sno) || !subject) continue;

    const participants = cleanText(r[2]) || '—';
    const faculty      = cleanText(r[3]);
    const scheduled    = cleanText(r[4]);
    const actual       = cleanText(r[5]);
    const hrs          = (() => {
      const n = parseFloat(r[6]);
      return Number.isFinite(n) ? n : null;
    })();

    const dup = await prisma.trainingPlanItem.findFirst({
      where: { planId: plan.id, serialNo: sno },
    });
    if (dup) { skippedDup++; continue; }

    await prisma.trainingPlanItem.create({
      data: {
        planId: plan.id,
        serialNo: sno,
        subject,
        participants,
        faculty,
        scheduledMonth: scheduled,
        actualMonth: actual,
        hoursPerMonth: hrs,
        status: 'PLANNED',
        createdById: systemUserId,
      },
    });
    added++;
  }
  console.log(`Plan items: ${added} added, ${skippedDup} already present.`);
}

// ─── 3. TRAINING SESSIONS (autoclave file) ───────────────────────────────────
function parseHeaderBlock(rows) {
  // Header rows hold "Date of training: ...   Duration: ..." in a single cell,
  // followed by Place, Faculty, Subject lines.
  const flat = (i) => String(rows[i]?.[0] || '').replace(/\s+/g, ' ').trim();

  const datesLine = flat(2);
  const placeLine = flat(3);
  const facultyLine = flat(4);
  const subjectLine = flat(5);

  // "Date of training: 03/01/2024 to 06/01/2024 ... Duration: 3 days @ 2hrs/day"
  let fromDate = null, toDate = null;
  const dateMatch = datesLine.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})(?:\s*to\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}))?/i);
  if (dateMatch) {
    fromDate = parseDmy(dateMatch[1]);
    toDate   = dateMatch[2] ? parseDmy(dateMatch[2]) : null;
  }
  const duration = (datesLine.match(/Duration:\s*(.+)$/i) || [])[1] || null;
  const place    = (placeLine.match(/Place of Training:\s*(.+)$/i) || [])[1] || null;
  const faculty  = (facultyLine.match(/Faculty\s*:\s*(.+?)(?:\s+Signature.*)?$/i) || [])[1] || null;
  const subject  = (subjectLine.match(/Subject of training:\s*(.+)$/i) || [])[1] || null;

  return {
    fromDate, toDate,
    duration: cleanText(duration),
    place:    cleanText(place),
    faculty:  cleanText(faculty),
    subject:  cleanText(subject),
  };
}

async function importTrainingSessions(systemUserId) {
  const wb = XLSX.readFile(REC_FILE);
  // Cache empCode → employee for quick attendee lookups.
  const allEmps = await prisma.employee.findMany({ select: { id: true, name: true, empCode: true } });
  const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  const byName = new Map(allEmps.map((e) => [normalize(e.name), e]));

  // Roughly match attendee names from the spreadsheet to existing employees.
  // Initials like "D Prathyusha" / "P. Ashok Babu" → strip dots/spaces and
  // compare against `byName`; if no exact hit, try a substring contains.
  const matchEmployee = (raw) => {
    const norm = normalize(raw);
    if (!norm) return null;
    if (byName.has(norm)) return byName.get(norm);
    for (const [key, emp] of byName) {
      if (key.includes(norm) || norm.includes(key)) {
        // Require at least 5 chars overlap to avoid spurious matches.
        if (Math.min(key.length, norm.length) >= 5) return emp;
      }
    }
    return null;
  };

  let sessionsCreated = 0, sessionsSkipped = 0, attendeesAdded = 0;
  // Generate session numbers per year so we don't collide with the live sequence.
  let yearCounters = {};
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

  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
    const meta = parseHeaderBlock(rows);
    if (!meta.subject || !meta.fromDate || !meta.faculty) {
      console.log(`  ! ${sheetName}: missing subject/from-date/faculty — skipped`);
      continue;
    }

    // Skip if a session with the same subject + from-date already exists.
    const existing = await prisma.trainingSession.findFirst({
      where: { subject: meta.subject, trainingDateFrom: meta.fromDate },
    });
    if (existing) { sessionsSkipped++; continue; }

    const yr = meta.fromDate.getFullYear();
    const sessionNumber = await nextSessionNumber(yr);

    // Attendees: rows 8..12 (Sl no, Name, Designation, Department, Sign, Eval details, Date of eval, Eval by)
    const attendees = [];
    for (let i = 8; i < rows.length; i++) {
      const r = rows[i];
      const slNo = parseInt(r[0], 10);
      const name = cleanText(r[1]);
      if (!Number.isFinite(slNo) || !name) continue;
      const evalDetails = cleanText(r[5]);
      const dateOfEvalLine = String(r[6] || '');
      const dateOfEval = parseDmy(dateOfEvalLine);
      const evaluatedBy = cleanText(r[7]);
      attendees.push({ name, evalDetails, dateOfEval, evaluatedBy });
    }

    const matched = attendees.map((a) => ({ ...a, emp: matchEmployee(a.name) }));
    const matchedEmps = matched.filter((a) => a.emp);
    const unmatchedNames = matched.filter((a) => !a.emp).map((a) => a.name);

    await prisma.trainingSession.create({
      data: {
        sessionNumber,
        subject: meta.subject,
        trainingDateFrom: meta.fromDate,
        trainingDateTo: meta.toDate,
        duration: meta.duration,
        place: meta.place,
        faculty: meta.faculty,
        notes: unmatchedNames.length
          ? `Imported from ${sheetName}. Unmatched attendees (no Employee record): ${unmatchedNames.join('; ')}`
          : `Imported from ${sheetName}.`,
        createdById: systemUserId,
        attendees: matchedEmps.length
          ? {
              create: matchedEmps.map((a) => ({
                employeeId: a.emp.id,
                evaluationDetails: a.evalDetails,
                dateOfEvaluation: a.dateOfEval,
                evaluatedBy: a.evaluatedBy,
              })),
            }
          : undefined,
      },
    });
    sessionsCreated++;
    attendeesAdded += matchedEmps.length;
    if (unmatchedNames.length) {
      console.log(`  ! ${sheetName}: ${unmatchedNames.length} attendee(s) not matched: ${unmatchedNames.join('; ')}`);
    }
  }
  console.log(`Training sessions: ${sessionsCreated} created, ${sessionsSkipped} already present.`);
  console.log(`Attendees added: ${attendeesAdded}`);
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
(async () => {
  // Pick any admin/superadmin row to credit the records to — falls back to
  // the first user found if none exists. We need *some* createdById because
  // the relations are required.
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
  await importEmployeesAndSkills(owner.id);

  console.log('\n── 2. Training Plan FY 2023-24 ──');
  await importTrainingPlan(owner.id);

  console.log('\n── 3. Training Sessions ──');
  await importTrainingSessions(owner.id);

  console.log('\nDone.');
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
