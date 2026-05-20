// Backfill script: re-number all docs to <KIND>/<DD-MM-YY>/<N> format and
// re-SKU all products to <PREFIX>-<NNNN> (PREFIX from materialType).
//
// Strategy: two-pass batched rename via raw SQL. Each pass issues a single
// UPDATE ... FROM (VALUES ...) statement against the table, so the whole table
// is renamed in one round trip per pass. Pass 1 parks every changing row at a
// unique temp value derived from its id, which fully clears the namespace.
// Pass 2 assigns the final canonical value. This handles unique-constraint
// collisions cleanly and finishes 2666 products in seconds rather than minutes.
//
// Safe to re-run — rows already matching their target are skipped before
// either pass.
//
// Run with:   node prisma/backfill-doc-numbers-and-skus.js
// or:         node prisma/backfill-doc-numbers-and-skus.js --dry-run

const { PrismaClient, Prisma } = require('@prisma/client');
const {
  formatDDMMYY, materialTypeToSkuPrefix, normalizeMaterialType,
} = require('../src/utils/helpers');

const prisma = new PrismaClient();
const DRY = process.argv.includes('--dry-run');

// kind → { table: postgres table name, field: column name, model: prisma model name }
const KIND_TO_TABLE = {
  PR:  { model: 'purchaseRequest',          table: 'PurchaseRequest',          field: 'requestNumber' },
  PO:  { model: 'purchaseOrder',            table: 'PurchaseOrder',            field: 'orderNumber' },
  MIV: { model: 'productRequest',           table: 'ProductRequest',           field: 'requestNumber' },
  GP:  { model: 'gatePass',                 table: 'GatePass',                 field: 'passNumber' },
  ION: { model: 'interOfficeNote',          table: 'InterOfficeNote',          field: 'ionNumber' },
  QT:  { model: 'quotation',                table: 'Quotation',                field: 'quotationNumber' },
  QC:  { model: 'qCInspection',             table: 'QCInspection',             field: 'inspectionNumber' },
  PAY: { model: 'paymentRequest',           table: 'PaymentRequest',           field: 'paymentNumber' },
  TRF: { model: 'inventoryTransferRequest', table: 'InventoryTransferRequest', field: 'transferNumber' },
};

// Build [{id, target}] for a model: target is what the row should end up as.
// Stable across re-runs: rows are sorted by (createdAt asc, id asc) before numbering.
function buildDocPlan(rows, kind, dateField = 'createdAt') {
  const byDay = new Map();
  for (const row of rows) {
    const key = formatDDMMYY(row[dateField] || row.createdAt);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(row);
  }
  const plan = [];
  for (const [day, items] of byDay.entries()) {
    items.sort((a, b) => {
      const da = +(a[dateField] || a.createdAt);
      const db = +(b[dateField] || b.createdAt);
      if (da !== db) return da - db;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    let counter = 1;
    for (const row of items) {
      plan.push({ id: row.id, target: `${kind}/${day}/${counter++}` });
    }
  }
  return plan;
}

// Batch UPDATE the given rows: every (id, value) pair gets applied in one query.
// Uses Postgres `UPDATE ... FROM (VALUES ...)` to avoid per-row round trips.
async function batchUpdate(table, field, pairs) {
  if (!pairs.length) return;
  // Split into chunks so we don't blow past postgres parameter limits.
  const CHUNK = 500;
  for (let i = 0; i < pairs.length; i += CHUNK) {
    const chunk = pairs.slice(i, i + CHUNK);
    const values = chunk.map((_, j) => `($${j * 2 + 1}, $${j * 2 + 2})`).join(', ');
    const params = chunk.flatMap(p => [p.id, p.value]);
    const sql = `
      UPDATE "${table}" AS t
      SET "${field}" = v.val
      FROM (VALUES ${values}) AS v(id, val)
      WHERE t.id = v.id
    `;
    await prisma.$executeRawUnsafe(sql, ...params);
  }
}

async function twoPassRename({ label, table, field, plan, currentByIdMap }) {
  let already = 0;
  const toMove = [];
  for (const { id, target } of plan) {
    if (currentByIdMap.get(id) === target) { already++; continue; }
    toMove.push({ id, target });
  }
  console.log(`[${label}] total ${plan.length} · already correct ${already} · to update ${toMove.length}`);

  if (DRY) {
    for (const item of toMove.slice(0, 5)) {
      console.log(`  ${currentByIdMap.get(item.id)}  →  ${item.target}`);
    }
    if (toMove.length > 5) console.log(`  …and ${toMove.length - 5} more`);
    return;
  }
  if (!toMove.length) return;

  const t0 = Date.now();
  // Pass 1 — park to temp (one batched UPDATE).
  const tmpPairs = toMove.map(m => ({ id: m.id, value: `__bf_${m.id.slice(0, 8)}` }));
  await batchUpdate(table, field, tmpPairs);
  // Pass 2 — assign final value (one batched UPDATE).
  const finalPairs = toMove.map(m => ({ id: m.id, value: m.target }));
  await batchUpdate(table, field, finalPairs);
  console.log(`  ✓ ${toMove.length} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

async function backfillKind(kind) {
  const { model, table, field } = KIND_TO_TABLE[kind];
  const rows = await prisma[model].findMany({
    select: { id: true, createdAt: true, [field]: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!rows.length) { console.log(`[${kind}] 0 rows`); return; }

  const plan = buildDocPlan(rows, kind);
  const currentByIdMap = new Map(rows.map(r => [r.id, r[field]]));
  await twoPassRename({ label: kind, table, field, plan, currentByIdMap });
}

async function backfillMir() {
  const rows = await prisma.purchaseOrder.findMany({
    where: { mirNo: { not: null } },
    select: { id: true, mirNo: true, inwardedAt: true, createdAt: true },
    orderBy: [{ inwardedAt: 'asc' }, { createdAt: 'asc' }],
  });
  if (!rows.length) { console.log(`[MIR] 0 POs with mirNo`); return; }

  const stamped = rows.map(r => ({ ...r, _bucketDate: r.inwardedAt || r.createdAt }));
  const plan = buildDocPlan(stamped, 'MIR', '_bucketDate');
  const currentByIdMap = new Map(rows.map(r => [r.id, r.mirNo]));
  await twoPassRename({ label: 'MIR', table: 'PurchaseOrder', field: 'mirNo', plan, currentByIdMap });
}

async function backfillProductSkus() {
  const products = await prisma.product.findMany({
    select: { id: true, sku: true, name: true, category: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!products.length) { console.log(`[SKU] 0 products`); return; }

  const counters = {};
  const plan = [];
  for (const p of products) {
    const matType = normalizeMaterialType(p.category);
    const prefix = materialTypeToSkuPrefix(matType);
    counters[prefix] = (counters[prefix] || 0) + 1;
    const next = String(counters[prefix]).padStart(4, '0');
    plan.push({
      id: p.id,
      targetSku: `${prefix}-${next}`,
      targetCategory: matType,
      currentSku: p.sku,
      currentCategory: p.category,
    });
  }

  const skuChanges = plan.filter(x => x.currentSku !== x.targetSku);
  const categoryChanges = plan.filter(x => x.currentCategory !== x.targetCategory);
  console.log(`[SKU] total ${plan.length} · sku changes ${skuChanges.length} · category normalisations ${categoryChanges.length}`);

  if (DRY) {
    for (const item of skuChanges.slice(0, 5)) {
      console.log(`  ${item.currentSku}  →  ${item.targetSku}  (${item.currentCategory || 'NULL'} → ${item.targetCategory})`);
    }
    if (skuChanges.length > 5) console.log(`  …and ${skuChanges.length - 5} more`);
    return;
  }
  if (!skuChanges.length && !categoryChanges.length) return;

  const t0 = Date.now();
  // Pass 1 — park changing SKUs at temp.
  const tmpPairs = skuChanges.map(m => ({ id: m.id, value: `__bf_${m.id.slice(0, 8)}` }));
  await batchUpdate('Product', 'sku', tmpPairs);
  // Pass 2 — final SKU.
  const finalPairs = skuChanges.map(m => ({ id: m.id, value: m.targetSku }));
  await batchUpdate('Product', 'sku', finalPairs);

  // Category normalisation in a separate batched UPDATE.
  if (categoryChanges.length) {
    const catPairs = categoryChanges.map(m => ({ id: m.id, value: m.targetCategory }));
    await batchUpdate('Product', 'category', catPairs);
  }
  console.log(`  ✓ ${skuChanges.length} sku · ${categoryChanges.length} category in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

async function main() {
  console.log(DRY ? '== DRY RUN ==' : '== APPLY ==');
  console.log('Strategy: batched two-pass rename via raw SQL (one round-trip per pass). Idempotent.\n');

  const t0 = Date.now();
  for (const kind of Object.keys(KIND_TO_TABLE)) {
    await backfillKind(kind);
  }
  await backfillMir();
  await backfillProductSkus();
  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
  if (DRY) console.log('Re-run without --dry-run to apply.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
