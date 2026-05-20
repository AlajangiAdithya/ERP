// Backfill script: re-number all docs to <KIND>/<DD-MM-YY>/<N> format and
// re-SKU all products to <PREFIX>-<NNNN> (PREFIX from materialType).
//
// Strategy is two-pass per table to avoid colliding with the existing unique
// constraint on the numbering column. Pass 1 renames every row to a unique
// temporary value (`__tmp_<id>`), which clears the namespace. Pass 2 renames
// each temp value to the final canonical value. This is idempotent — re-running
// against an already-backfilled table is a no-op (every row matches its target
// before pass 1 even starts, and is skipped).
//
// Safe to run repeatedly. Also safe to run as part of a deploy: rows added
// after the backfill point go through the normal generateSequentialNumber path
// which already uses this exact format.
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

// Build [{id, target}] for a model: target is what the row should end up as.
function buildDocPlan(rows, kind, dateField = 'createdAt') {
  const byDay = new Map();
  for (const row of rows) {
    const key = formatDDMMYY(row[dateField] || row.createdAt);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(row);
  }
  const plan = [];
  for (const [day, items] of byDay.entries()) {
    let counter = 1;
    for (const row of items) {
      plan.push({ id: row.id, target: `${kind}/${day}/${counter++}` });
    }
  }
  return plan;
}

// Generic two-pass renamer. `getCurrent(row)` returns the current value on a
// freshly-fetched row, so we can skip rows that already match their target.
async function twoPassRename({ label, model, field, plan, currentByIdMap }) {
  let already = 0, willChange = 0;
  const toMove = [];
  for (const { id, target } of plan) {
    const current = currentByIdMap.get(id);
    if (current === target) { already++; continue; }
    toMove.push({ id, target, current });
  }
  willChange = toMove.length;
  console.log(`[${label}] total ${plan.length} · already correct ${already} · to update ${willChange}`);

  if (DRY) {
    for (const { current, target } of toMove.slice(0, 5)) {
      console.log(`  ${current}  →  ${target}`);
    }
    if (toMove.length > 5) console.log(`  …and ${toMove.length - 5} more`);
    return willChange;
  }
  if (!toMove.length) return 0;

  // Pass 1 — park every changing row at a unique temp name so the final
  // namespace clears completely.
  for (const item of toMove) {
    const tmp = `__bf_${item.id.slice(0, 8)}`;
    await prisma[model].update({ where: { id: item.id }, data: { [field]: tmp } });
    item.tmp = tmp;
  }

  // Pass 2 — assign final value. No collisions because every other row was
  // moved out of the way.
  for (const item of toMove) {
    await prisma[model].update({ where: { id: item.id }, data: { [field]: item.target } });
  }
  return willChange;
}

async function backfillKind(kind) {
  const { model, field } = KIND_TO_MODEL[kind];
  const rows = await prisma[model].findMany({
    select: { id: true, createdAt: true, [field]: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!rows.length) { console.log(`[${kind}] 0 rows`); return; }

  const plan = buildDocPlan(rows, kind);
  const currentByIdMap = new Map(rows.map(r => [r.id, r[field]]));
  await twoPassRename({ label: kind, model, field, plan, currentByIdMap });
}

async function backfillMir() {
  const rows = await prisma.purchaseOrder.findMany({
    where: { mirNo: { not: null } },
    select: { id: true, mirNo: true, inwardedAt: true, createdAt: true },
    orderBy: [{ inwardedAt: 'asc' }, { createdAt: 'asc' }],
  });
  if (!rows.length) { console.log(`[MIR] 0 POs with mirNo`); return; }

  // Reuse buildDocPlan with inwardedAt fallback to createdAt.
  const stamped = rows.map(r => ({ ...r, _bucketDate: r.inwardedAt || r.createdAt }));
  const plan = buildDocPlan(stamped, 'MIR', '_bucketDate');
  const currentByIdMap = new Map(rows.map(r => [r.id, r.mirNo]));
  await twoPassRename({ label: 'MIR', model: 'purchaseOrder', field: 'mirNo', plan, currentByIdMap });
}

async function backfillProductSkus() {
  const products = await prisma.product.findMany({
    select: { id: true, sku: true, name: true, category: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!products.length) { console.log(`[SKU] 0 products`); return; }

  // Bucket by SKU prefix derived from category — counter is per-prefix, padded to 4 digits.
  // We also re-write category to its canonical materialType in the same pass.
  const counters = {};
  const plan = []; // {id, targetSku, targetCategory}
  for (const p of products) {
    const matType = normalizeMaterialType(p.category);
    const prefix = materialTypeToSkuPrefix(matType);
    counters[prefix] = (counters[prefix] || 0) + 1;
    const next = String(counters[prefix]).padStart(4, '0');
    plan.push({ id: p.id, targetSku: `${prefix}-${next}`, targetCategory: matType, currentSku: p.sku, currentCategory: p.category });
  }

  const skuChanges = plan.filter(x => x.currentSku !== x.targetSku);
  const categoryChanges = plan.filter(x => x.currentCategory !== x.targetCategory);
  console.log(`[SKU] total ${plan.length} · sku changes ${skuChanges.length} · category normalisations ${categoryChanges.length}`);
  if (!skuChanges.length && !categoryChanges.length) return;

  if (DRY) {
    for (const item of skuChanges.slice(0, 5)) {
      console.log(`  ${item.currentSku}  →  ${item.targetSku}  (${item.currentCategory || 'NULL'} → ${item.targetCategory})`);
    }
    if (skuChanges.length > 5) console.log(`  …and ${skuChanges.length - 5} more`);
    return;
  }

  // Pass 1 — park every row whose SKU needs to change at a temp value.
  for (const item of skuChanges) {
    await prisma.product.update({ where: { id: item.id }, data: { sku: `__bf_${item.id.slice(0, 8)}` } });
  }
  // Pass 2 — final SKU + canonical category in one update.
  for (const item of plan) {
    const data = {};
    if (item.currentSku !== item.targetSku) data.sku = item.targetSku;
    if (item.currentCategory !== item.targetCategory) data.category = item.targetCategory;
    if (Object.keys(data).length === 0) continue;
    await prisma.product.update({ where: { id: item.id }, data });
  }
}

async function main() {
  console.log(DRY ? '== DRY RUN ==' : '== APPLY ==');
  console.log('Strategy: two-pass rename (park to temp → assign final). Idempotent — safe to rerun.\n');

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
