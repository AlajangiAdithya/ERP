// Deletes everything created by the v2 import so we can re-run cleanly.
// Keeps the 209 canonical MD products intact (codes loaded from material-details.json).
//
// Dry-run by default. Pass --commit to actually delete.

const path = require('path');
const fs = require('fs');
const prisma = require('../src/config/db');

const COMMIT = process.argv.includes('--commit');

async function run() {
  console.log(`Mode: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`);

  const mdRaw = JSON.parse(fs.readFileSync(path.join(__dirname, 'material-details.json'), 'utf8'));
  const mdCodes = new Set(mdRaw.map((m) => String(m.materialCode)));
  console.log(`MD codes to keep: ${mdCodes.size}`);

  const allProducts = await prisma.product.findMany({
    select: { id: true, materialCode: true, name: true, currentStock: true },
  });
  const toDelete = allProducts.filter((p) => !p.materialCode || !mdCodes.has(p.materialCode));
  console.log(`Products to delete: ${toDelete.length}`);
  console.log(`Products kept (MD canonical): ${allProducts.length - toDelete.length}`);

  const ssBatches = await prisma.productBatch.count({ where: { referenceType: 'StockStatement' } });
  const ssQc = await prisma.qCInspection.count({ where: { inspectionNumber: { startsWith: 'SS-' } } });
  console.log(`StockStatement batches: ${ssBatches}`);
  console.log(`SS-prefixed QC records: ${ssQc}`);

  if (!COMMIT) return;

  const ids = toDelete.map((p) => p.id);
  if (ids.length) {
    const d0 = await prisma.productUnitStock.deleteMany({ where: { productId: { in: ids } } });
    console.log(`Deleted ${d0.count} productUnitStock rows.`);
  }
  const d1 = await prisma.productBatch.deleteMany({ where: { referenceType: 'StockStatement' } });
  console.log(`Deleted ${d1.count} StockStatement batches.`);
  if (ids.length) {
    const d1b = await prisma.productBatch.deleteMany({ where: { productId: { in: ids } } });
    console.log(`Deleted ${d1b.count} remaining batches on doomed products.`);
  }
  const d2 = await prisma.qCInspection.deleteMany({ where: { inspectionNumber: { startsWith: 'SS-' } } });
  console.log(`Deleted ${d2.count} SS QC records.`);
  if (ids.length) {
    const d3 = await prisma.product.deleteMany({ where: { id: { in: ids } } });
    console.log(`Deleted ${d3.count} products.`);
  }

  // Also reset currentStock on the MD products that v2 might have touched.
  const reset = await prisma.product.updateMany({
    where: { materialCode: { in: Array.from(mdCodes) } },
    data: { currentStock: 0 },
  });
  console.log(`Reset currentStock=0 on ${reset.count} MD products.`);
}

run()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
