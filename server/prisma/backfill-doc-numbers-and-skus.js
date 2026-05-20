// Backfill script: re-number all docs to <KIND>/<DD-MM-YY>/<N> format and
// re-SKU all products to <PREFIX>-<NNNN> (PREFIX from materialType).
//
// Per-kind, per-day grouping uses createdAt to assign the daily counter in
// chronological order. Old records get the same simple format as new ones,
// so users see a consistent scheme across history.
//
// Run with:   node prisma/backfill-doc-numbers-and-skus.js
// or:         node prisma/backfill-doc-numbers-and-skus.js --dry-run

const { PrismaClient } = require('@prisma/client');
const {
  formatDDMMYY, materialTypeToSkuPrefix, normalizeMaterialType,
} = require('../src/utils/helpers');

const prisma = new PrismaClient();
const DRY = process.argv.includes('--dry-run');

const KIND_TO_MODEL = {
  PR:  { model: 'purchaseRequest',          field: 'requestNumber' },
  PO:  { model: 'purchaseOrder',            field: 'orderNumber' },
  MIV: { model: 'productRequest',           field: 'requestNumber' },
  GP:  { model: 'gatePass',                 field: 'passNumber' },
  ION: { model: 'interOfficeNote',          field: 'ionNumber' },
  QT:  { model: 'quotation',                field: 'quotationNumber' },
  QC:  { model: 'qCInspection',             field: 'inspectionNumber' },
  PAY: { model: 'paymentRequest',           field: 'paymentNumber' },
  TRF: { model: 'inventoryTransferRequest', field: 'transferNumber' },
};

async function backfillKind(kind) {
  const { model, field } = KIND_TO_MODEL[kind];
  const rows = await prisma[model].findMany({
    select: { id: true, createdAt: true, [field]: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`\n[${kind}] ${rows.length} rows`);

  // Group by DD-MM-YY of createdAt.
  const byDay = new Map();
  for (const row of rows) {
    const key = formatDDMMYY(row.createdAt);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(row);
  }

  let updated = 0;
  for (const [day, items] of byDay.entries()) {
    let counter = 1;
    for (const row of items) {
      const newNum = `${kind}/${day}/${counter++}`;
      if (row[field] === newNum) continue;
      if (DRY) {
        console.log(`  ${row[field]}  →  ${newNum}`);
      } else {
        try {
          await prisma[model].update({ where: { id: row.id }, data: { [field]: newNum } });
        } catch (e) {
          // Collisions can happen mid-run if a partial backfill ran before.
          // Fall back to a temp suffix then retry once the rest of the day is renamed.
          if (e.code === 'P2002') {
            const tmp = `${newNum}__tmp_${row.id.slice(0, 6)}`;
            await prisma[model].update({ where: { id: row.id }, data: { [field]: tmp } });
            console.log(`  collision on ${newNum} — parked as ${tmp}; rerun the script to resolve`);
          } else {
            throw e;
          }
        }
      }
      updated++;
    }
  }
  console.log(`[${kind}] ${updated} rows ${DRY ? 'WOULD CHANGE' : 'updated'}`);
}

async function backfillMir() {
  // PurchaseOrder.mirNo — same scheme, kind MIR, scoped by inwardedAt (fallback createdAt)
  const rows = await prisma.purchaseOrder.findMany({
    where: { mirNo: { not: null } },
    select: { id: true, mirNo: true, inwardedAt: true, createdAt: true },
    orderBy: [{ inwardedAt: 'asc' }, { createdAt: 'asc' }],
  });
  console.log(`\n[MIR] ${rows.length} POs with mirNo`);

  const byDay = new Map();
  for (const row of rows) {
    const dt = row.inwardedAt || row.createdAt;
    const key = formatDDMMYY(dt);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(row);
  }
  let updated = 0;
  for (const [day, items] of byDay.entries()) {
    let counter = 1;
    for (const row of items) {
      const newNum = `MIR/${day}/${counter++}`;
      if (row.mirNo === newNum) continue;
      if (DRY) {
        console.log(`  ${row.mirNo}  →  ${newNum}`);
      } else {
        try {
          await prisma.purchaseOrder.update({ where: { id: row.id }, data: { mirNo: newNum } });
        } catch (e) {
          if (e.code === 'P2002') {
            const tmp = `${newNum}__tmp_${row.id.slice(0, 6)}`;
            await prisma.purchaseOrder.update({ where: { id: row.id }, data: { mirNo: tmp } });
            console.log(`  MIR collision on ${newNum} — parked as ${tmp}; rerun to resolve`);
          } else {
            throw e;
          }
        }
      }
      updated++;
    }
  }
  console.log(`[MIR] ${updated} rows ${DRY ? 'WOULD CHANGE' : 'updated'}`);
}

async function backfillProductSkus() {
  const products = await prisma.product.findMany({
    select: { id: true, sku: true, name: true, category: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`\n[SKU] ${products.length} products`);

  // Bucket by SKU prefix derived from category.
  const counters = { RAW: 0, CONS: 0, TOOL: 0, OTH: 0 };
  let updated = 0;
  for (const p of products) {
    const matType = normalizeMaterialType(p.category);
    const prefix = materialTypeToSkuPrefix(matType);
    counters[prefix] = (counters[prefix] || 0) + 1;
    const next = String(counters[prefix]).padStart(4, '0');
    const newSku = `${prefix}-${next}`;
    if (p.sku === newSku && p.category === matType) continue;
    if (DRY) {
      console.log(`  ${p.sku} (${p.category || 'NULL'})  →  ${newSku} (${matType})  [${p.name}]`);
    } else {
      try {
        await prisma.product.update({
          where: { id: p.id },
          data: { sku: newSku, category: matType },
        });
      } catch (e) {
        if (e.code === 'P2002') {
          const tmp = `${newSku}__tmp_${p.id.slice(0, 6)}`;
          await prisma.product.update({ where: { id: p.id }, data: { sku: tmp, category: matType } });
          console.log(`  SKU collision on ${newSku} — parked as ${tmp}; rerun to resolve`);
        } else {
          throw e;
        }
      }
    }
    updated++;
  }
  console.log(`[SKU] ${updated} products ${DRY ? 'WOULD CHANGE' : 'updated'}`);
}

async function main() {
  console.log(DRY ? '== DRY RUN ==' : '== APPLY ==');

  // Two-pass strategy to avoid mid-run unique collisions:
  // pass 1 — park all targets with a temp prefix so the namespace clears
  // pass 2 — rename to final values
  // For simplicity we use a single pass; collisions get parked and a second
  // invocation finishes the rename.

  for (const kind of Object.keys(KIND_TO_MODEL)) {
    await backfillKind(kind);
  }
  await backfillMir();
  await backfillProductSkus();

  console.log('\nDone.');
  if (DRY) console.log('Re-run without --dry-run to apply.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
