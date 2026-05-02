// Wipes all non-user, non-unit data from the database.
// Preserves: User, Session, Unit, AuditLog
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Wiping non-user data...');

  // Delete in dependency order (children first)
  const ops = [
    ['notification', () => prisma.notification.deleteMany()],
    ['paymentRequest', () => prisma.paymentRequest.deleteMany()],
    ['qcInspection', () => prisma.qCInspection.deleteMany()],
    ['ionItem', () => prisma.iONItem.deleteMany()],
    ['interOfficeNote', () => prisma.interOfficeNote.deleteMany()],
    ['gatePassItem', () => prisma.gatePassItem.deleteMany()],
    ['gatePass', () => prisma.gatePass.deleteMany()],
    ['inventoryTransferRequest', () => prisma.inventoryTransferRequest.deleteMany()],
    ['purchaseOrderItem', () => prisma.purchaseOrderItem.deleteMany()],
    ['purchaseOrder', () => prisma.purchaseOrder.deleteMany()],
    ['quotationItem', () => prisma.quotationItem.deleteMany()],
    ['quotation', () => prisma.quotation.deleteMany()],
    ['purchaseRequestItem', () => prisma.purchaseRequestItem.deleteMany()],
    ['purchaseRequest', () => prisma.purchaseRequest.deleteMany()],
    ['requestItem', () => prisma.requestItem.deleteMany()],
    ['productRequest', () => prisma.productRequest.deleteMany()],
    ['stockMovement', () => prisma.stockMovement.deleteMany()],
    ['productBatch', () => prisma.productBatch.deleteMany()],
    ['product', () => prisma.product.deleteMany()],
  ];

  for (const [name, fn] of ops) {
    try {
      const r = await fn();
      console.log(`  ${name}: ${r.count} deleted`);
    } catch (e) {
      console.log(`  ${name}: SKIP (${e.message.split('\n')[0]})`);
    }
  }

  // Show remaining users / units
  const users = await prisma.user.count();
  const units = await prisma.unit.count();
  console.log(`\nPreserved: users=${users} units=${units}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
