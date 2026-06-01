const prisma = require('../src/config/db');
(async () => {
  const units = await prisma.unit.findMany({ select: { id: true, name: true, code: true, isActive: true } });
  console.log('UNITS:');
  for (const u of units) console.log(' ', u.code, '|', u.name, '|', u.id, u.isActive ? '' : '(inactive)');

  const withMC = await prisma.product.count({ where: { materialCode: { not: null } } });
  const withoutMC = await prisma.product.count({ where: { materialCode: null } });
  console.log('\nProducts with materialCode:', withMC);
  console.log('Products without materialCode (auto-SKU):', withoutMC);

  const sample = await prisma.product.findMany({
    where: { materialCode: null },
    select: { id: true, name: true, sku: true, category: true, currentStock: true },
    take: 20,
  });
  console.log('\nFirst 20 auto-SKU products:');
  for (const p of sample) console.log(' ', p.sku, '|', p.category, '|', p.name, '| stock=', p.currentStock);

  await prisma.$disconnect();
})();
