const prisma = require('../src/config/db');
(async () => {
  const total = await prisma.product.count();
  const byCat = await prisma.product.groupBy({ by: ['category'], _count: { _all: true } });
  const batches = await prisma.productBatch.count({ where: { referenceType: 'StockStatement' } });
  const stationery = await prisma.product.count({ where: { category: 'Stationery' } });
  const withStock = await prisma.product.count({ where: { currentStock: { gt: 0 } } });
  console.log('Total active products:', total);
  console.log('Products with stock > 0:', withStock);
  console.log('Stationery products:', stationery);
  console.log('Stock-statement batches:', batches);
  console.log('Breakdown by category:');
  for (const c of byCat.sort((a, b) => b._count._all - a._count._all)) {
    console.log('  ', (c.category || '(null)').padEnd(28), c._count._all);
  }
  await prisma.$disconnect();
})();
