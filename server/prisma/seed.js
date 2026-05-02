const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Clear existing data in order
  await prisma.notification.deleteMany();
  await prisma.purchaseRequestItem.deleteMany();
  await prisma.purchaseRequest.deleteMany();
  await prisma.requestItem.deleteMany();
  await prisma.productRequest.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.session.deleteMany();
  await prisma.testReport.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.purchaseOrderItem.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.product.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.user.deleteMany();
  await prisma.unit.deleteMany();

  // ──── UNITS (6 fixed units: 1, 1A, 2, 3, 4, 5) ────
  const unit1 = await prisma.unit.create({ data: { name: 'Unit 1', code: '1' } });
  const unit1A = await prisma.unit.create({ data: { name: 'Unit 1A', code: '1A' } });
  const unit2 = await prisma.unit.create({ data: { name: 'Unit 2', code: '2' } });
  const unit3 = await prisma.unit.create({ data: { name: 'Unit 3', code: '3' } });
  const unit4 = await prisma.unit.create({ data: { name: 'Unit 4', code: '4' } });
  const unit5 = await prisma.unit.create({ data: { name: 'Unit 5', code: '5' } });
  console.log('Units created: 1, 1A, 2, 3, 4, 5');

  // ──── USERS ────
  const adminHash = await bcrypt.hash('Admin@123', 12);
  const managerHash = await bcrypt.hash('Manager@123', 12);
  const storeHash = await bcrypt.hash('Store@123', 12);
  const poHash = await bcrypt.hash('PO@123', 12);

  const admin = await prisma.user.create({
    data: { username: 'admin', passwordHash: adminHash, name: 'Admin User', role: 'ADMIN' },
  });
  const adminMadhu = await prisma.user.create({
    data: { username: 'madhubabu', passwordHash: adminHash, name: 'Madhubabu', role: 'ADMIN' },
  });
  const adminSuresh = await prisma.user.create({
    data: { username: 'suresh', passwordHash: adminHash, name: 'Suresh', role: 'ADMIN' },
  });
  const adminRamesh = await prisma.user.create({
    data: { username: 'rameshbabu', passwordHash: adminHash, name: 'Rameshbabu', role: 'ADMIN' },
  });
  const manager = await prisma.user.create({
    data: { username: 'rajesh', passwordHash: managerHash, name: 'Rajesh Kumar', role: 'MANAGER', unitId: unit1.id },
  });
  const manager2 = await prisma.user.create({
    data: { username: 'priya', passwordHash: managerHash, name: 'Priya Sharma', role: 'MANAGER', unitId: unit2.id },
  });
  const storeManager = await prisma.user.create({
    data: { username: 'store', passwordHash: storeHash, name: 'Store Manager', role: 'STORE_MANAGER' },
  });
  const purchaseOfficer = await prisma.user.create({
    data: { username: 'purchaser', passwordHash: poHash, name: 'Purchase Officer', role: 'PURCHASE_OFFICER' },
  });
  console.log('Users created');

  // ──── SUPPLIERS ────
  const suppliers = await Promise.all([
    prisma.supplier.create({ data: { name: 'Tata Chemicals Ltd', contactPerson: 'Amit Verma', phone: '+91-22-66658282', address: 'Mumbai, Maharashtra' } }),
    prisma.supplier.create({ data: { name: 'Asian Paints Raw Materials', contactPerson: 'Sneha Nair', phone: '+91-22-39818000', address: 'Andheri East, Mumbai' } }),
    prisma.supplier.create({ data: { name: 'Reliance Polymers', contactPerson: 'Vikram Patel', phone: '+91-79-35555000', address: 'Ahmedabad, Gujarat' } }),
    prisma.supplier.create({ data: { name: 'Hindustan Chemicals', contactPerson: 'Sunita Reddy', phone: '+91-40-23456789', address: 'Hyderabad, Telangana' } }),
    prisma.supplier.create({ data: { name: 'Supreme Steel Industries', contactPerson: 'Deepak Singh', phone: '+91-11-26789012', address: 'Faridabad, Haryana' } }),
  ]);
  console.log('Suppliers created');

  // ──── PRODUCTS (no money columns) ────
  const products = await Promise.all([
    prisma.product.create({ data: { name: 'Sodium Hydroxide (Caustic Soda)', sku: 'RAPS-CHEM-001', category: 'Chemicals', unit: 'kg', currentStock: 500, minStockLevel: 100, supplierId: suppliers[0].id } }),
    prisma.product.create({ data: { name: 'Hydrochloric Acid', sku: 'RAPS-CHEM-002', category: 'Chemicals', unit: 'litre', currentStock: 200, minStockLevel: 50, supplierId: suppliers[0].id } }),
    prisma.product.create({ data: { name: 'Titanium Dioxide Pigment', sku: 'RAPS-PIG-001', category: 'Pigments', unit: 'kg', currentStock: 150, minStockLevel: 30, supplierId: suppliers[1].id } }),
    prisma.product.create({ data: { name: 'Polyethylene Granules (HDPE)', sku: 'RAPS-POLY-001', category: 'Polymers', unit: 'kg', currentStock: 800, minStockLevel: 200, supplierId: suppliers[2].id } }),
    prisma.product.create({ data: { name: 'Polypropylene Resin', sku: 'RAPS-POLY-002', category: 'Polymers', unit: 'kg', currentStock: 350, minStockLevel: 100, supplierId: suppliers[2].id } }),
    prisma.product.create({ data: { name: 'Sulphuric Acid (98%)', sku: 'RAPS-CHEM-003', category: 'Chemicals', unit: 'litre', currentStock: 80, minStockLevel: 100, supplierId: suppliers[3].id } }),
    prisma.product.create({ data: { name: 'Zinc Oxide Industrial Grade', sku: 'RAPS-CHEM-004', category: 'Chemicals', unit: 'kg', currentStock: 250, minStockLevel: 50, supplierId: suppliers[3].id } }),
    prisma.product.create({ data: { name: 'Mild Steel Plates (6mm)', sku: 'RAPS-STL-001', category: 'Steel', unit: 'pcs', currentStock: 45, minStockLevel: 10, supplierId: suppliers[4].id } }),
    prisma.product.create({ data: { name: 'SS 304 Round Bar', sku: 'RAPS-STL-002', category: 'Steel', unit: 'meter', currentStock: 30, minStockLevel: 15, supplierId: suppliers[4].id } }),
    prisma.product.create({ data: { name: 'Carbon Black N330', sku: 'RAPS-PIG-002', category: 'Pigments', unit: 'kg', currentStock: 120, minStockLevel: 40, supplierId: suppliers[1].id } }),
  ]);
  console.log('Products created');

  // ──── STOCK MOVEMENTS (initial stock) ────
  for (const product of products) {
    await prisma.stockMovement.create({
      data: {
        productId: product.id,
        type: 'IN',
        quantity: product.currentStock,
        referenceType: 'InitialStock',
        notes: 'Initial stock entry',
        performedBy: admin.id,
      },
    });
  }
  console.log('Stock movements created');

  // ──── SAMPLE MIV REQUESTS ────
  const req1 = await prisma.productRequest.create({
    data: {
      requestNumber: 'REQ-001',
      managerId: manager.id,
      unitId: unit1.id,
      status: 'COLLECTED',
      notes: 'Needed for batch production run',
      clearanceNotes: 'Approved for full quantity',
      clearedById: storeManager.id,
      clearedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      collectedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
      items: {
        create: [
          { productId: products[0].id, quantity: 50, approvedQty: 50 },
          { productId: products[1].id, quantity: 20, approvedQty: 20 },
        ],
      },
    },
  });

  const req2 = await prisma.productRequest.create({
    data: {
      requestNumber: 'REQ-002',
      managerId: manager2.id,
      unitId: unit2.id,
      status: 'APPROVED',
      notes: 'Polymer supply for production',
      clearanceNotes: 'Partial approval - reduced HDPE qty',
      clearedById: storeManager.id,
      clearedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      items: {
        create: [
          { productId: products[3].id, quantity: 200, approvedQty: 150 },
          { productId: products[4].id, quantity: 100, approvedQty: 100 },
        ],
      },
    },
  });

  const req3 = await prisma.productRequest.create({
    data: {
      requestNumber: 'REQ-003',
      managerId: manager.id,
      unitId: unit1.id,
      status: 'PENDING',
      notes: 'Monthly chemical restocking',
      items: {
        create: [
          { productId: products[5].id, quantity: 30 },
          { productId: products[6].id, quantity: 25 },
          { productId: products[9].id, quantity: 15 },
        ],
      },
    },
  });
  console.log('MIV requests created');

  // ──── SAMPLE PURCHASE REQUESTS ────
  // PR-1: Approved and partially purchased
  const pr1 = await prisma.purchaseRequest.create({
    data: {
      requestNumber: 'PR-001',
      managerId: manager.id,
      unitId: unit1.id,
      status: 'IN_PROGRESS',
      notes: 'Need chemicals for upcoming tender batch',
      adminNotes: 'Reduce caustic soda qty, enough in stock. Approve HCl in full.',
      adminApprovedById: admin.id,
      adminApprovedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      items: {
        create: [
          { productId: products[0].id, productName: 'Sodium Hydroxide (Caustic Soda)', productUnit: 'kg', requestedQty: 1000, adminApprovedQty: 500, purchasedQty: 250 },
          { productId: products[1].id, productName: 'Hydrochloric Acid', productUnit: 'litre', requestedQty: 500, adminApprovedQty: 500, purchasedQty: 500 },
        ],
      },
    },
  });

  // PR-2: Approved, not yet started
  const pr2 = await prisma.purchaseRequest.create({
    data: {
      requestNumber: 'PR-002',
      managerId: manager2.id,
      unitId: unit2.id,
      status: 'APPROVED',
      notes: 'Polymer resupply for Q1',
      adminNotes: 'Approved. Get quotes from Reliance first.',
      adminApprovedById: admin.id,
      adminApprovedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      items: {
        create: [
          { productId: products[3].id, productName: 'Polyethylene Granules (HDPE)', productUnit: 'kg', requestedQty: 2000, adminApprovedQty: 2000, purchasedQty: 0 },
          { productId: products[4].id, productName: 'Polypropylene Resin', productUnit: 'kg', requestedQty: 1000, adminApprovedQty: 800, purchasedQty: 0 },
        ],
      },
    },
  });

  // PR-3: Pending admin approval
  const pr3 = await prisma.purchaseRequest.create({
    data: {
      requestNumber: 'PR-003',
      managerId: manager.id,
      unitId: unit1.id,
      status: 'PENDING_ADMIN',
      notes: 'Steel required for fabrication work',
      items: {
        create: [
          { productId: products[7].id, productName: 'Mild Steel Plates (6mm)', productUnit: 'pcs', requestedQty: 100 },
          { productId: products[8].id, productName: 'SS 304 Round Bar', productUnit: 'meter', requestedQty: 50 },
        ],
      },
    },
  });
  console.log('Purchase requests created');

  // ──── SAMPLE PURCHASE ORDERS ────
  await prisma.purchaseOrder.create({
    data: {
      orderNumber: 'PO-2024-001',
      supplierId: suppliers[0].id,
      status: 'RECEIVED',
      orderDate: new Date('2024-11-15'),
      receivedDate: new Date('2024-11-22'),
      items: {
        create: [
          { productId: products[0].id, quantity: 500, receivedQty: 500 },
        ],
      },
    },
  });

  await prisma.purchaseOrder.create({
    data: {
      orderNumber: 'PO-2024-002',
      supplierId: suppliers[2].id,
      status: 'SENT',
      orderDate: new Date('2024-12-01'),
      expectedDate: new Date('2024-12-15'),
      items: {
        create: [
          { productId: products[3].id, quantity: 800 },
        ],
      },
    },
  });
  console.log('Purchase orders created');

  // ──── SAMPLE AUDIT LOGS ────
  const auditEntries = [
    { userId: admin.id, action: 'CREATE', entity: 'User', details: { name: 'Rajesh Kumar', role: 'MANAGER', unit: '1' } },
    { userId: admin.id, action: 'CREATE', entity: 'User', details: { name: 'Priya Sharma', role: 'MANAGER', unit: '2' } },
    { userId: admin.id, action: 'CREATE', entity: 'User', details: { name: 'Store Manager', role: 'STORE_MANAGER' } },
    { userId: admin.id, action: 'CREATE', entity: 'User', details: { name: 'Purchase Officer', role: 'PURCHASE_OFFICER' } },
    { userId: manager.id, action: 'CREATE', entity: 'ProductRequest', details: { requestNumber: 'REQ-001', unit: '1' } },
    { userId: storeManager.id, action: 'UPDATE', entity: 'ProductRequest', details: { requestNumber: 'REQ-001', action: 'APPROVED' } },
    { userId: manager.id, action: 'CREATE', entity: 'PurchaseRequest', details: { requestNumber: 'PR-001', unit: '1' } },
    { userId: admin.id, action: 'ADMIN_APPROVE', entity: 'PurchaseRequest', details: { requestNumber: 'PR-001', action: 'APPROVED' } },
  ];

  for (const entry of auditEntries) {
    await prisma.auditLog.create({ data: entry });
  }
  console.log('Audit logs created');

  // ──── SAMPLE NOTIFICATIONS ────
  await prisma.notification.create({
    data: {
      type: 'LOW_STOCK',
      title: 'LOW: Sulphuric Acid (98%)',
      message: 'Sulphuric Acid (98%) (RAPS-CHEM-003) stock is at 80 litre. Minimum level: 100.',
      productId: products[5].id,
      targetRole: 'ADMIN',
      sentById: storeManager.id,
    },
  });

  await prisma.notification.create({
    data: {
      type: 'NEW_PURCHASE_ASSIGNMENT',
      title: 'New Purchase Assignment: PR-001',
      message: 'Purchase request PR-001 from Rajesh Kumar (Unit 1) has been approved. Please proceed with procurement.',
      targetRole: 'PURCHASE_OFFICER',
      sentById: admin.id,
    },
  });
  console.log('Notifications created');

  console.log('\nSeed completed successfully!');
  console.log('\n── Login Credentials ──');
  console.log('Admin:            admin / Admin@123');
  console.log('Manager (Unit 1): rajesh / Manager@123');
  console.log('Manager (Unit 2): priya / Manager@123');
  console.log('Store Manager:    store / Store@123');
  console.log('Purchase Officer: purchaser / PO@123');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
