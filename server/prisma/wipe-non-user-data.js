// Wipes ALL ERP data from the database.
// Preserves: User, Unit
// Also clears: Session (logs everyone out) and AuditLog
//
// Run on the EC2 box AFTER taking a manual backup:
//   sudo /usr/local/bin/raps-backup
//   cd /var/www/raps/server && node prisma/wipe-non-user-data.js
//
// Delete order is dictated by FK constraints. Any change here needs to keep
// ProductBatch (which references GatePassItem + QCInspection without onDelete)
// ahead of those parents.

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Wiping ERP data (users/units/audit logs preserved)...');

  const ops = [
    // Leaf-most: notifications and per-row attachments
    ['notification', () => prisma.notification.deleteMany()],
    ['paymentRequest', () => prisma.paymentRequest.deleteMany()],

    // ProductBatch first — it references GatePassItem + QCInspection + Product
    // without onDelete, so those parents can't be wiped until batches are gone.
    ['productBatch', () => prisma.productBatch.deleteMany()],

    // QC chain
    ['qcInspectionItem', () => prisma.qCInspectionItem.deleteMany()],
    ['qcInspection', () => prisma.qCInspection.deleteMany()],

    // ION
    ['ionItem', () => prisma.iONItem.deleteMany()],
    ['interOfficeNote', () => prisma.interOfficeNote.deleteMany()],

    // Gate pass
    ['gatePassItem', () => prisma.gatePassItem.deleteMany()],
    ['gatePass', () => prisma.gatePass.deleteMany()],

    // Inventory transfers
    ['inventoryTransferRequest', () => prisma.inventoryTransferRequest.deleteMany()],

    // PO chain (allocations + sources are junctions on PurchaseOrder/Item)
    ['purchaseOrderItemAllocation', () => prisma.purchaseOrderItemAllocation.deleteMany()],
    ['purchaseOrderItem', () => prisma.purchaseOrderItem.deleteMany()],
    ['purchaseOrderSource', () => prisma.purchaseOrderSource.deleteMany()],
    ['purchaseOrder', () => prisma.purchaseOrder.deleteMany()],

    // Quotation chain
    ['quotationItem', () => prisma.quotationItem.deleteMany()],
    ['quotationSource', () => prisma.quotationSource.deleteMany()],
    ['quotation', () => prisma.quotation.deleteMany()],

    // PR chain
    ['purchaseRequestItem', () => prisma.purchaseRequestItem.deleteMany()],
    ['purchaseRequest', () => prisma.purchaseRequest.deleteMany()],

    // Suppliers — safe to drop now that quotations + POs are gone
    ['supplier', () => prisma.supplier.deleteMany()],

    // Tenders — independent of the procurement chain
    ['tender', () => prisma.tender.deleteMany()],

    // MIV (legacy ProductRequest chain)
    ['requestItem', () => prisma.requestItem.deleteMany()],
    ['productRequest', () => prisma.productRequest.deleteMany()],

    // Stock side
    ['stockMovement', () => prisma.stockMovement.deleteMany()],
    ['productUnitStock', () => prisma.productUnitStock.deleteMany()],
    ['product', () => prisma.product.deleteMany()],

    // Sessions + audit log — log everyone out, drop the trail
    ['session', () => prisma.session.deleteMany()],
    ['auditLog', () => prisma.auditLog.deleteMany()],
  ];

  for (const [name, fn] of ops) {
    try {
      const r = await fn();
      console.log(`  ${name}: ${r.count} deleted`);
    } catch (e) {
      console.log(`  ${name}: SKIP (${e.message.split('\n')[0]})`);
    }
  }

  const users = await prisma.user.count();
  const units = await prisma.unit.count();
  console.log(`\nPreserved: users=${users} units=${units}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
