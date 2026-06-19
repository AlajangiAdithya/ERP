// Import Work Orders from the Cash Flow workbook into the ERP database.
//
//   1. Run  `python prisma/extract-work-orders.py`  to (re)generate
//      work-orders-import.json from the source .xlsx.
//   2. Run  `node prisma/import-work-orders.js`      to load it into the DB.
//      Add  DRY_RUN=1  to preview without writing:  DRY_RUN=1 node prisma/import-work-orders.js
//
// Each JSON entry is one Work Order (rows sharing an Order No were grouped into
// line items by the extractor). Orders whose PDC is a relative term ("FIM+3
// Months" …) import with pdcDate = null and the term kept in deliveryClause.
// ensureUnits() first creates any unit named in the sheet that doesn't exist
// yet (SHAR, IBRPTM, Nasik, CPDC, Adibatla, ANSP, Design); the sheet's Unit
// text then resolves against the Unit records (matched by code or normalised
// name, so "Unit-4", "UNIT-1", "CPDC" all map). Anything still unresolved is
// kept as free text in assignedUnitName. Orders are created IN_PROGRESS with
// their billed quantity seeded.
//
// Idempotent: an order already imported (matched by supplyOrderNo + the import
// marker in remarks) is not re-created — instead its unit assignment is
// re-resolved, so adding a missing Unit in the DB and re-running this script
// maps the older imports too. Manually assigned units are never overridden.

const path = require('path');
const fs = require('fs');
// Load DATABASE_URL from server/.env so this script works when run directly
// (Prisma Client doesn't auto-load .env the way the prisma CLI does).
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');
const { generateSequentialNumber } = require('../src/utils/helpers');

const prisma = new PrismaClient();
const DRY_RUN = !!process.env.DRY_RUN;
const IMPORT_MARKER = 'Imported from Cash Flow sheet';
const DATA_FILE = path.join(__dirname, 'work-orders-import.json');

// Resolve the sheet's raw unit text ("Unit-4", "UNIT-1", "CPDC", "SHAR"...)
// to a DB unit id. Units are matched on code and on a normalised name, so
// "Unit-1A" === code "1A" === name "Unit 1A". Returns null when no Unit record
// matches (the caller then keeps the raw text as assignedUnitName).
function buildUnitResolver(units) {
  const byKey = new Map();
  const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const u of units) {
    byKey.set(norm(u.code), u);
    byKey.set(norm(u.name), u);
    byKey.set(norm(`unit${u.code}`), u);
  }
  return (name) => {
    if (!name) return null;
    const u = byKey.get(norm(name)) || byKey.get(norm(`unit${name}`));
    return u ? u.id : null;
  };
}

// Units that must exist for the assignments to land on a real Unit record.
// Anything else named in the sheet is added on top of this baseline.
const NEW_UNIT_BASELINE = ['SHAR', 'IBRPTM', 'Nasik', 'CPDC', 'Adibatla', 'ANSP', 'Design'];

// Create any unit named in the sheet (or the baseline) that doesn't already
// resolve to an existing Unit. Idempotent — re-runs only create what's missing.
async function ensureUnits(orders) {
  const units = await prisma.unit.findMany({ select: { id: true, name: true, code: true } });
  const resolve = buildUnitResolver(units);
  const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  const wanted = new Set(NEW_UNIT_BASELINE);
  for (const o of orders) if (o.assignedUnitName) wanted.add(o.assignedUnitName);

  const usedCodes = new Set(units.map((u) => String(u.code || '').toUpperCase()));
  const createdNorm = new Set();
  let createdCount = 0;

  for (const name of wanted) {
    if (resolve(name) || createdNorm.has(norm(name))) continue; // already exists
    let base = name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 16) || 'UNIT';
    let code = base;
    let n = 1;
    while (usedCodes.has(code)) code = `${base}${n++}`;
    if (DRY_RUN) {
      console.log(`  [unit] would create "${name}" (code ${code})`);
    } else {
      await prisma.unit.create({ data: { name, code, isActive: true } });
    }
    usedCodes.add(code);
    createdNorm.add(norm(name));
    createdCount += 1;
  }
  if (createdCount) console.log(`Units ensured: ${createdCount} created${DRY_RUN ? ' (dry run)' : ''}`);
  return createdCount;
}

async function pickImporter() {
  // Prefer the role that owns Work Orders, fall back sensibly.
  for (const role of ['SUPPLY_CHAIN', 'ADMIN', 'SUPERADMIN']) {
    const u = await prisma.user.findFirst({
      where: { role, isActive: true },
      select: { id: true, name: true, role: true },
    });
    if (u) return u;
  }
  return prisma.user.findFirst({ where: { isActive: true }, select: { id: true, name: true, role: true } });
}

async function main() {
  if (!fs.existsSync(DATA_FILE)) {
    throw new Error(`Missing ${DATA_FILE} — run "python prisma/extract-work-orders.py" first.`);
  }
  const orders = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));

  const importer = await pickImporter();
  if (!importer) throw new Error('No active user found to attribute the import to.');

  // Create any unit named in the sheet that doesn't exist yet (SHAR, IBRPTM,
  // Nasik, CPDC, Adibatla, ANSP, Design …) so every order resolves to a real
  // unit. SHAR is special downstream (auto-accepted) — handled in the API.
  await ensureUnits(orders);

  const units = await prisma.unit.findMany({ select: { id: true, name: true, code: true } });
  const resolveUnit = buildUnitResolver(units);

  // Already-imported orders (by supplyOrderNo + marker). Re-runs don't
  // re-create them, but DO re-resolve their unit assignment so units added to
  // the DB after the first import get picked up.
  const existing = await prisma.workOrder.findMany({
    where: { remarks: { contains: IMPORT_MARKER } },
    select: { id: true, supplyOrderNo: true, assignedUnitId: true, assignedUnitName: true },
  });
  const alreadyImported = new Map(existing.map((w) => [w.supplyOrderNo, w]));

  console.log(`Loading ${orders.length} orders as ${importer.name} (${importer.role})${DRY_RUN ? '  [DRY RUN]' : ''}`);

  let created = 0; let skipped = 0; let remapped = 0; let renamed = 0;
  let assigned = 0; let unassigned = 0;
  const now = new Date();

  for (const o of orders) {
    const prior = alreadyImported.get(o.supplyOrderNo);
    if (prior) {
      // Never touch an order someone already assigned to a real unit.
      if (prior.assignedUnitId) { skipped += 1; continue; }

      const unitId = resolveUnit(o.assignedUnitName);
      if (unitId) {
        remapped += 1;
        if (!DRY_RUN) {
          await prisma.workOrder.update({
            where: { id: prior.id },
            data: {
              assignedUnitId: unitId,
              assignedUnitName: null,
              unitAcceptedAt: now,
              unitAcceptedById: importer.id,
              unitAcceptanceNote: IMPORT_MARKER,
            },
          });
        }
        console.log(`  ~ ${o.supplyOrderNo}  | unit resolved -> ${o.assignedUnitName}`);
      } else if ((o.assignedUnitName || null) !== (prior.assignedUnitName || null)) {
        renamed += 1;
        if (!DRY_RUN) {
          await prisma.workOrder.update({
            where: { id: prior.id },
            data: { assignedUnitName: o.assignedUnitName || null },
          });
        }
        console.log(`  ~ ${o.supplyOrderNo}  | unit name -> "${o.assignedUnitName}"`);
      } else {
        skipped += 1;
      }
      continue;
    }

    const assignedUnitId = resolveUnit(o.assignedUnitName);
    if (assignedUnitId) assigned += 1; else unassigned += 1;

    if (DRY_RUN) {
      console.log(
        `  + ${o.supplyOrderNo}  | items ${o.items.length} | qty ${o.orderQuantity}`
        + ` | billed ${o.billedQty} | unit ${o.assignedUnitName || '(not provided)'}${assignedUnitId ? '' : ' [name only]'}`,
      );
      created += 1;
      continue;
    }

    const workOrderNumber = await generateSequentialNumber(prisma, 'WO');
    await prisma.workOrder.create({
      data: {
        workOrderNumber,
        supplyOrderNo: o.supplyOrderNo,
        supplyOrderDate: new Date(o.supplyOrderDate || o.pdcDate || Date.now()),
        nomenclature: o.nomenclature || null,
        customerName: o.customerName,
        orderQuantity: o.orderQuantity,
        orderUnit: 'Nos',
        // Relative-term orders import with no real PDC; the term lives in
        // deliveryClause and Planning fills the date in later.
        pdcDate: o.pdcDate ? new Date(o.pdcDate) : null,
        deliveryClause: o.deliveryClause || null,
        remarks: o.remarks || null,
        items: { create: o.items },

        assignedUnitId: assignedUnitId || null,
        // Unresolved unit text stays visible in the UI instead of "Unassigned".
        assignedUnitName: assignedUnitId ? null : (o.assignedUnitName || null),

        // Existing in-progress orders: stamp acceptance so IN_PROGRESS is coherent,
        // and seed the billed quantity that was already delivered/invoiced.
        status: 'IN_PROGRESS',
        deliveryStatus: o.deliveryStatus || 'IN_PROGRESS',
        deliveredQty: o.billedQty || 0,
        invoicedQty: o.billedQty || 0,
        adminAcceptedAt: now,
        adminAcceptedById: importer.id,
        adminAcceptanceNote: IMPORT_MARKER,
        ...(assignedUnitId
          ? { unitAcceptedAt: now, unitAcceptedById: importer.id, unitAcceptanceNote: IMPORT_MARKER }
          : {}),

        createdById: importer.id,
      },
    });
    created += 1;
  }

  console.log('─'.repeat(50));
  console.log(`Created   : ${created}${DRY_RUN ? ' (would create)' : ''} (unit set ${assigned}, name only ${unassigned})`);
  console.log(`Remapped  : ${remapped} (existing imports now resolved to a unit)${DRY_RUN ? ' (would update)' : ''}`);
  console.log(`Renamed   : ${renamed} (existing imports, unit name text updated)${DRY_RUN ? ' (would update)' : ''}`);
  console.log(`Untouched : ${skipped} (already imported / manually assigned)`);
}

main()
  .catch((e) => { console.error('Import failed:', e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
