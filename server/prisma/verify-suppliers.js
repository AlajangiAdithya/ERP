// Quick verification: confirms the Supplier table is populated and links are healthy.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const [totalSuppliers, qLinked, qiLinked, poLinked, poiLinked, qiWithProduct, poiWithProduct, sampleProduct] = await Promise.all([
    prisma.supplier.count(),
    prisma.quotation.count({ where: { supplierId: { not: null } } }),
    prisma.quotationItem.count({ where: { supplierId: { not: null } } }),
    prisma.purchaseOrder.count({ where: { supplierId: { not: null } } }),
    prisma.purchaseOrderItem.count({ where: { supplierId: { not: null } } }),
    prisma.quotationItem.count({ where: { productId: { not: null } } }),
    prisma.purchaseOrderItem.count({ where: { productId: { not: null } } }),
    prisma.product.findFirst({
      where: { isActive: true, purchaseOrderItems: { some: {} } },
      select: { id: true, name: true },
    }),
  ]);

  console.log('Supplier inventory:');
  console.log(`  Suppliers in directory: ${totalSuppliers}`);
  console.log(`  Quotation rows w/ supplierId: ${qLinked}`);
  console.log(`  QuotationItem rows w/ supplierId: ${qiLinked}`);
  console.log(`  PurchaseOrder rows w/ supplierId: ${poLinked}`);
  console.log(`  PurchaseOrderItem rows w/ supplierId: ${poiLinked}`);
  console.log(`  QuotationItem rows w/ productId: ${qiWithProduct}`);
  console.log(`  PurchaseOrderItem rows w/ productId: ${poiWithProduct}`);

  if (sampleProduct) {
    console.log(`\nSample supplier history for "${sampleProduct.name}":`);
    const items = await prisma.purchaseOrderItem.findMany({
      where: { productId: sampleProduct.id },
      include: {
        purchaseOrder: { select: { orderNumber: true, supplierName: true, createdAt: true } },
        supplier: { select: { name: true } },
      },
      orderBy: { purchaseOrder: { createdAt: 'desc' } },
      take: 5,
    });
    for (const it of items) {
      console.log(`  ${it.purchaseOrder.createdAt.toISOString().split('T')[0]} · ${it.supplier?.name || it.purchaseOrder.supplierName} · ₹${it.unitPrice}/${it.productUnit} × ${it.quantity} = ₹${it.totalPrice} (${it.purchaseOrder.orderNumber})`);
    }
  } else {
    console.log('No product with linked PO items yet.');
  }

  await prisma.$disconnect();
})();
