const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const counts = {
    products: await p.product.count(),
    purchaseRequests: await p.purchaseRequest.count(),
    purchaseOrders: await p.purchaseOrder.count(),
    quotations: await p.quotation.count(),
    stockMovements: await p.stockMovement.count(),
    productBatches: await p.productBatch.count(),
    users: await p.user.count(),
    units: await p.unit.count(),
  };
  console.log(JSON.stringify(counts, null, 2));
  await p.$disconnect();
})();
