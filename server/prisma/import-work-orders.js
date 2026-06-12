// Import Work Orders from the Cash Flow workbook into the ERP database.
//
//   1. Run  `python prisma/extract-work-orders.py`  to (re)generate
//      work-orders-import.json from the source .xlsx.
//   2. Run  `node prisma/import-work-orders.js`      to load it into the DB.
//      Add  DRY_RUN=1  to preview without writing:  DRY_RUN=1 node prisma/import-work-orders.js
//
// Each JSON entry is one Work Order (rows sharing an Order No were grouped into
// line items by the extractor). Orders without a real PDC date were already
// dropped. Factory units Unit-1/1A/2/3/4/5 are mapped to the 6 fixed DB units;
// any other location is left unassigned ("not provided"). Orders are created
// IN_PROGRESS with their billed quantity seeded so existing progress is kept.
//
// Idempotent: an order already imported (matched by supplyOrderNo + the import
// marker in remarks) is skipped, so the script is safe to re-run.

const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const { generateSequentialNumber } = require('../src/utils/helpers');

const prisma = new PrismaClient();
const DRY_RUN = !!process.env.DRY_RUN;
const IMPORT_MARKER = 'Imported from Cash Flow sheet';
const DATA_FILE = path.join(__dirname, 'work-orders-import.json');

// Resolve an Excel unit code ("1", "1A", "2"...) to a DB unit id. Units are
// matched on code first, then on a normalised name ("Unit 1A" === "unit1a").
function buildUnitResolver(units) {
  const byKey = new Map();
  const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const u of units) {
    byKey.set(norm(u.code), u);
    byKey.set(norm(u.name), u);
  }
  return (code) => {
    if (!code) return null;
    const u = byKey.get(norm(code)) || byKey.get(norm(`unit${code}`));
    return u ? u.id : null;
  };
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

  const [units, importer] = await Promise.all([
    prisma.unit.findMany({ select: { id: true, name: true, code: true } }),
    pickImporter(),
  ]);
  if (!importer) throw new Error('No active user found to attribute the import to.');
  const resolveUnit = buildUnitResolver(units);

  // Already-imported orders (by supplyOrderNo + marker) so re-runs skip them.
  const existing = await prisma.workOrder.findMany({
    where: { remarks: { contains: IMPORT_MARKER } },
    select: { supplyOrderNo: true },
  });
  const alreadyImported = new Set(existing.map((w) => w.supplyOrderNo));

  console.log(`Loading ${orders.length} orders as ${importer.name} (${importer.role})${DRY_RUN ? '  [DRY RUN]' : ''}`);

  let created = 0; let skipped = 0; let assigned = 0; let unassigned = 0;
  const now = new Date();

  for (const o of orders) {
    if (alreadyImported.has(o.supplyOrderNo)) {
      skipped += 1;
      continue;
    }

    const assignedUnitId = resolveUnit(o.assignedUnitCode);
    if (assignedUnitId) assigned += 1; else unassigned += 1;

    if (DRY_RUN) {
      console.log(
        `  + ${o.supplyOrderNo}  | items ${o.items.length} | qty ${o.orderQuantity}`
        + ` | billed ${o.billedQty} | unit ${o.assignedUnitCode || '(not provided)'}`,
      );
      created += 1;
      continue;
    }

    const workOrderNumber = await generateSequentialNumber(prisma, 'WO');
    await prisma.workOrder.create({
      data: {
        workOrderNumber,
        supplyOrderNo: o.supplyOrderNo,
        supplyOrderDate: new Date(o.supplyOrderDate),
        nomenclature: o.nomenclature || null,
        customerName: o.customerName,
        orderQuantity: o.orderQuantity,
        orderUnit: 'Nos',
        pdcDate: new Date(o.pdcDate),
        remarks: o.remarks || null,
        items: { create: o.items },

        assignedUnitId: assignedUnitId || null,

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
  console.log(`Created   : ${created}${DRY_RUN ? ' (would create)' : ''}`);
  console.log(`Skipped   : ${skipped} (already imported)`);
  console.log(`Unit set  : ${assigned}`);
  console.log(`No unit   : ${unassigned} (left "not provided")`);
}

main()
  .catch((e) => { console.error('Import failed:', e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
