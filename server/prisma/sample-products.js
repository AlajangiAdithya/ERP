const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const products = await p.product.findMany({
    select: { name: true, category: true, currentStock: true, unit: true, minStockLevel: true },
    orderBy: { currentStock: 'desc' },
  });
  console.log(`TOTAL: ${products.length}`);
  console.log(`WITH CATEGORY: ${products.filter(x => x.category).length}`);
  console.log(`WITH MIN > 0: ${products.filter(x => x.minStockLevel > 0).length}`);
  console.log('\n--- Top 60 by stock ---');
  products.slice(0, 60).forEach(x => console.log(`  ${x.currentStock} ${x.unit} | cat=${x.category||'-'} | ${x.name.slice(0, 80)}`));
  console.log('\n--- Random sample of 60 ---');
  const sample = products.sort(() => Math.random() - 0.5).slice(0, 60);
  sample.forEach(x => console.log(`  ${x.currentStock} ${x.unit} | ${x.name.slice(0, 80)}`));
  await p.$disconnect();
})();
