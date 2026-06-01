// Cleanup script: removes the StockStatement batches and the auto-SKU products
// created by the rejected v1 import (server/scripts/import-store-stock.js).
//
// Dry-run by default — pass --commit to actually delete.
//   node scripts/cleanup-bad-import.js [--commit]

const prisma = require('../src/config/db');

const COMMIT = process.argv.includes('--commit');

async function run() {
  console.log(`Mode: ${COMMIT ? 'COMMIT (will delete)' : 'DRY-RUN'}`);

  // 1. StockStatement-origin batches.
  const ssBatches = await prisma.productBatch.findMany({
    where: { referenceType: 'StockStatement' },
    select: { id: true, productId: true, quantity: true, batchNo: true },
  });
  console.log(`Found ${ssBatches.length} StockStatement batches.`);

  // 2. Auto-SKU products (no materialCode) — these are the ones v1 created when
  //    it couldn't match a stock row to an existing product.
  const autoProducts = await prisma.product.findMany({
    where: { materialCode: null },
    select: { id: true, name: true, sku: true, category: true, currentStock: true },
  });
  console.log(`Found ${autoProducts.length} products without materialCode.`);

  // Sanity check: any of these auto products have non-StockStatement batches?
  const productIds = autoProducts.map((p) => p.id);
  const otherRefs = productIds.length
    ? await prisma.productBatch.findMany({
      where: { productId: { in: productIds }, referenceType: { not: 'StockStatement' } },
      select: { id: true, productId: true, referenceType: true },
    })
    : [];
  if (otherRefs.length) {
    console.log(`WARNING: ${otherRefs.length} non-StockStatement batches reference these products. Will NOT delete those products.`);
  }
  const safeToDeleteProductIds = productIds.filter(
    (id) => !otherRefs.some((b) => b.productId === id),
  );

  // Also check stock movements / unit stocks for safety.
  if (productIds.length) {
    const moves = await prisma.stockMovement.count({ where: { productId: { in: productIds } } });
    const reqItems = await prisma.requestItem.count({ where: { productId: { in: productIds } } });
    const prItems = await prisma.purchaseRequestItem.count({ where: { productId: { in: productIds } } });
    console.log(`  Cross-references: ${moves} stock movements, ${reqItems} request items, ${prItems} PR items.`);
  }

  // QCInspections created by v2 won't exist yet (this runs before v2). Skip QC cleanup.

  if (!COMMIT) {
    console.log('\nDry-run finished. Re-run with --commit to delete.');
    return;
  }

  // Delete in safe order: ProductUnitStock for these products → batches → products.
  if (productIds.length) {
    const del0 = await prisma.productUnitStock.deleteMany({ where: { productId: { in: productIds } } });
    console.log(`Deleted ${del0.count} productUnitStock rows.`);
    const del1 = await prisma.productBatch.deleteMany({
      where: { OR: [{ referenceType: 'StockStatement' }, { productId: { in: productIds } }] },
    });
    console.log(`Deleted ${del1.count} batches.`);
  } else {
    const del1 = await prisma.productBatch.deleteMany({ where: { referenceType: 'StockStatement' } });
    console.log(`Deleted ${del1.count} batches.`);
  }

  if (safeToDeleteProductIds.length) {
    const del2 = await prisma.product.deleteMany({ where: { id: { in: safeToDeleteProductIds } } });
    console.log(`Deleted ${del2.count} products.`);
  }
}

run()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
