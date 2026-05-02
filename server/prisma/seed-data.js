const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Seeding example data (keeping existing users & units)...\n');

  // ── Fetch existing users & units ──
  const users = await prisma.user.findMany({ select: { id: true, name: true, role: true, unitId: true } });
  const units = await prisma.unit.findMany({ select: { id: true, name: true, code: true } });

  const byRole = (role) => users.find(u => u.role === role);
  const byUsername = (name) => users.find(u => u.name === name);
  const unitByCode = (code) => units.find(u => u.code === code);

  const admin = byUsername('Madhubabu') || byRole('ADMIN');
  const storeManager = byRole('STORE_MANAGER');
  const purchaseOfficer = byRole('PURCHASE_OFFICER');
  const manager1 = users.find(u => u.role === 'MANAGER' && u.unitId === unitByCode('UNIT-1')?.id);
  const manager2 = users.find(u => u.role === 'MANAGER' && u.unitId === unitByCode('UNIT-2')?.id);
  const manager3 = users.find(u => u.role === 'MANAGER' && u.unitId === unitByCode('UNIT-3')?.id);
  const labUser = byRole('LAB');

  const unit1 = unitByCode('UNIT-1');
  const unit2 = unitByCode('UNIT-2');
  const unit3 = unitByCode('UNIT-3');
  const unit4 = unitByCode('UNIT-4');

  if (!admin || !storeManager || !manager1 || !unit1) {
    console.error('Missing required users or units. Run the main seed first.');
    process.exit(1);
  }

  // ── Clean non-user tables ──
  await prisma.notification.deleteMany();
  await prisma.purchaseRequestItem.deleteMany();
  await prisma.purchaseRequest.deleteMany();
  await prisma.requestItem.deleteMany();
  await prisma.productRequest.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.product.deleteMany();
  console.log('Cleared existing data (users & units kept)\n');

  // ═══════════════════════════════════════════
  //  PRODUCTS (25 realistic industrial items)
  // ═══════════════════════════════════════════
  const productData = [
    // Chemicals
    { name: 'Sodium Hydroxide (Caustic Soda)', sku: 'RAPS-CHEM-001', category: 'Chemicals', unit: 'kg', currentStock: 520, minStockLevel: 100, maxStockLevel: 1000 },
    { name: 'Hydrochloric Acid (35%)', sku: 'RAPS-CHEM-002', category: 'Chemicals', unit: 'litre', currentStock: 180, minStockLevel: 50, maxStockLevel: 500 },
    { name: 'Sulphuric Acid (98%)', sku: 'RAPS-CHEM-003', category: 'Chemicals', unit: 'litre', currentStock: 75, minStockLevel: 100, maxStockLevel: 400 },
    { name: 'Phosphoric Acid', sku: 'RAPS-CHEM-004', category: 'Chemicals', unit: 'litre', currentStock: 60, minStockLevel: 30, maxStockLevel: 200 },
    { name: 'Zinc Oxide Industrial Grade', sku: 'RAPS-CHEM-005', category: 'Chemicals', unit: 'kg', currentStock: 250, minStockLevel: 50, maxStockLevel: 500 },
    // Polymers
    { name: 'Polyethylene Granules (HDPE)', sku: 'RAPS-POLY-001', category: 'Polymers', unit: 'kg', currentStock: 800, minStockLevel: 200, maxStockLevel: 2000 },
    { name: 'Polypropylene Resin', sku: 'RAPS-POLY-002', category: 'Polymers', unit: 'kg', currentStock: 340, minStockLevel: 100, maxStockLevel: 1000 },
    { name: 'PVC Compound', sku: 'RAPS-POLY-003', category: 'Polymers', unit: 'kg', currentStock: 450, minStockLevel: 100, maxStockLevel: 800 },
    // Steel
    { name: 'Mild Steel Plates (6mm)', sku: 'RAPS-STL-001', category: 'Steel', unit: 'pcs', currentStock: 42, minStockLevel: 10, maxStockLevel: 100 },
    { name: 'SS 304 Round Bar', sku: 'RAPS-STL-002', category: 'Steel', unit: 'meter', currentStock: 28, minStockLevel: 15, maxStockLevel: 80 },
    { name: 'Galvanized Iron Sheets', sku: 'RAPS-STL-003', category: 'Steel', unit: 'pcs', currentStock: 65, minStockLevel: 20, maxStockLevel: 150 },
    { name: 'MS Angle (50x50x5)', sku: 'RAPS-STL-004', category: 'Steel', unit: 'meter', currentStock: 90, minStockLevel: 25, maxStockLevel: 200 },
    // Pigments
    { name: 'Titanium Dioxide Pigment', sku: 'RAPS-PIG-001', category: 'Pigments', unit: 'kg', currentStock: 140, minStockLevel: 30, maxStockLevel: 300 },
    { name: 'Carbon Black N330', sku: 'RAPS-PIG-002', category: 'Pigments', unit: 'kg', currentStock: 110, minStockLevel: 40, maxStockLevel: 250 },
    { name: 'Iron Oxide Red', sku: 'RAPS-PIG-003', category: 'Pigments', unit: 'kg', currentStock: 85, minStockLevel: 20, maxStockLevel: 200 },
    // Consumables
    { name: 'Welding Electrodes (3.15mm)', sku: 'RAPS-CON-001', category: 'Consumables', unit: 'box', currentStock: 35, minStockLevel: 10, maxStockLevel: 80 },
    { name: 'Grinding Discs (125mm)', sku: 'RAPS-CON-002', category: 'Consumables', unit: 'pcs', currentStock: 120, minStockLevel: 30, maxStockLevel: 300 },
    { name: 'Safety Gloves (Nitrile)', sku: 'RAPS-CON-003', category: 'Consumables', unit: 'box', currentStock: 22, minStockLevel: 15, maxStockLevel: 60 },
    { name: 'Cutting Wheels (355mm)', sku: 'RAPS-CON-004', category: 'Consumables', unit: 'pcs', currentStock: 50, minStockLevel: 15, maxStockLevel: 100 },
    // Lubricants
    { name: 'Hydraulic Oil (ISO 68)', sku: 'RAPS-LUB-001', category: 'Lubricants', unit: 'litre', currentStock: 200, minStockLevel: 50, maxStockLevel: 500 },
    { name: 'Gear Oil (EP 220)', sku: 'RAPS-LUB-002', category: 'Lubricants', unit: 'litre', currentStock: 80, minStockLevel: 30, maxStockLevel: 200 },
    // Electrical
    { name: 'Copper Wire (2.5 sq mm)', sku: 'RAPS-ELE-001', category: 'Electrical', unit: 'meter', currentStock: 500, minStockLevel: 100, maxStockLevel: 1000 },
    { name: 'Cable Ties (300mm)', sku: 'RAPS-ELE-002', category: 'Electrical', unit: 'box', currentStock: 40, minStockLevel: 10, maxStockLevel: 80 },
    // Packaging
    { name: 'HDPE Drums (200L)', sku: 'RAPS-PKG-001', category: 'Packaging', unit: 'pcs', currentStock: 18, minStockLevel: 10, maxStockLevel: 50 },
    { name: 'Corrugated Boxes (Large)', sku: 'RAPS-PKG-002', category: 'Packaging', unit: 'pcs', currentStock: 150, minStockLevel: 50, maxStockLevel: 400 },
  ];

  const products = [];
  for (const p of productData) {
    products.push(await prisma.product.create({ data: p }));
  }
  console.log(`${products.length} products created`);

  // ═══════════════════════════════════════════
  //  STOCK MOVEMENTS (initial stock + recent activity)
  // ═══════════════════════════════════════════
  // Initial stock entries
  for (const p of products) {
    await prisma.stockMovement.create({
      data: {
        productId: p.id, type: 'IN', quantity: p.currentStock,
        referenceType: 'InitialStock', notes: 'Opening stock for FY 2026-27',
        performedBy: storeManager.id,
      },
    });
  }

  // Recent inward entries
  const recentInwards = [
    { idx: 0, qty: 100, batch: 'BATCH-CS-2604', days: 5, notes: 'Received from Tata Chemicals' },
    { idx: 5, qty: 300, batch: 'BATCH-HD-2604', days: 4, notes: 'HDPE shipment - quality checked' },
    { idx: 8, qty: 15, batch: 'BATCH-MS-2604', days: 3, notes: 'MS plates from Supreme Steel' },
    { idx: 12, qty: 50, batch: 'BATCH-TD-2604', days: 2, notes: 'TiO2 pigment restocking' },
    { idx: 19, qty: 80, batch: 'BATCH-HO-2604', days: 1, notes: 'Hydraulic oil barrel received' },
    { idx: 15, qty: 20, batch: 'BATCH-WE-2604', days: 1, notes: 'Welding electrodes from local dealer' },
  ];
  for (const entry of recentInwards) {
    await prisma.stockMovement.create({
      data: {
        productId: products[entry.idx].id, type: 'IN', quantity: entry.qty,
        batchNumber: entry.batch, referenceType: 'InwardEntry', notes: entry.notes,
        performedBy: storeManager.id,
        createdAt: new Date(Date.now() - entry.days * 24 * 60 * 60 * 1000),
      },
    });
  }

  // Recent outward (collected) movements
  const recentOutwards = [
    { idx: 0, qty: 50, unit: unit1.id, days: 6, notes: 'Collected by unit 1 for batch production (REQ-001)' },
    { idx: 1, qty: 20, unit: unit1.id, days: 6, notes: 'Collected by unit 1 for batch production (REQ-001)' },
    { idx: 5, qty: 150, unit: unit2.id, days: 4, notes: 'Collected by unit 2 for polymer processing (REQ-002)' },
    { idx: 6, qty: 80, unit: unit2.id, days: 4, notes: 'Collected by unit 2 for polymer processing (REQ-002)' },
    { idx: 16, qty: 15, unit: unit3.id, days: 2, notes: 'Collected by unit 3 for maintenance work' },
    { idx: 17, qty: 5, unit: unit3.id, days: 2, notes: 'Collected by unit 3 for safety restocking' },
  ];
  for (const entry of recentOutwards) {
    await prisma.stockMovement.create({
      data: {
        productId: products[entry.idx].id, type: 'OUT', quantity: entry.qty,
        referenceType: 'ProductRequest', notes: entry.notes,
        performedBy: storeManager.id, unitId: entry.unit,
        createdAt: new Date(Date.now() - entry.days * 24 * 60 * 60 * 1000),
      },
    });
  }

  // Stock adjustment
  await prisma.stockMovement.create({
    data: {
      productId: products[23].id, type: 'ADJUSTMENT', quantity: -2,
      referenceType: 'Adjustment', notes: 'Physical count correction — 2 drums damaged in transit',
      performedBy: storeManager.id,
      createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    },
  });

  console.log('Stock movements created (initial + inward + outward + adjustment)');

  // ═══════════════════════════════════════════
  //  MIV REQUESTS (ProductRequest)
  // ═══════════════════════════════════════════

  // REQ-001: Collected (by manager unit 1)
  await prisma.productRequest.create({
    data: {
      requestNumber: 'REQ-240401-001',
      managerId: manager1.id, unitId: unit1.id, status: 'COLLECTED',
      notes: 'Chemicals needed for batch production run',
      clearanceNotes: 'Approved — full quantity cleared',
      clearedById: storeManager.id,
      clearedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      collectedAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
      items: { create: [
        { productId: products[0].id, quantity: 50, approvedQty: 50 },
        { productId: products[1].id, quantity: 20, approvedQty: 20 },
      ]},
    },
  });

  // REQ-002: Collected (by manager unit 2)
  await prisma.productRequest.create({
    data: {
      requestNumber: 'REQ-240405-002',
      managerId: manager2.id, unitId: unit2.id, status: 'COLLECTED',
      notes: 'Polymer supply for Q1 production',
      clearanceNotes: 'Partial HDPE — reduced to 150kg (sufficient for current batch)',
      clearedById: storeManager.id,
      clearedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      collectedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
      items: { create: [
        { productId: products[5].id, quantity: 200, approvedQty: 150 },
        { productId: products[6].id, quantity: 80, approvedQty: 80 },
      ]},
    },
  });

  // REQ-003: Approved (waiting collection by manager unit 3)
  await prisma.productRequest.create({
    data: {
      requestNumber: 'REQ-240410-003',
      managerId: manager3.id, unitId: unit3.id, status: 'APPROVED',
      notes: 'Consumables for maintenance shutdown',
      clearanceNotes: 'Approved. Collect before Friday.',
      clearedById: storeManager.id,
      clearedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      items: { create: [
        { productId: products[16].id, quantity: 15, approvedQty: 15 },
        { productId: products[17].id, quantity: 5, approvedQty: 5 },
        { productId: products[18].id, quantity: 10, approvedQty: 10 },
      ]},
    },
  });

  // REQ-004: Pending (by manager unit 1)
  await prisma.productRequest.create({
    data: {
      requestNumber: 'REQ-240415-004',
      managerId: manager1.id, unitId: unit1.id, status: 'PENDING',
      notes: 'Monthly chemical restocking — urgent',
      items: { create: [
        { productId: products[2].id, quantity: 30 },
        { productId: products[4].id, quantity: 25 },
        { productId: products[14].id, quantity: 15 },
      ]},
    },
  });

  // REQ-005: Pending (by manager unit 2)
  await prisma.productRequest.create({
    data: {
      requestNumber: 'REQ-240416-005',
      managerId: manager2.id, unitId: unit2.id, status: 'PENDING',
      notes: 'Steel materials for fabrication project',
      items: { create: [
        { productId: products[8].id, quantity: 10 },
        { productId: products[9].id, quantity: 8 },
        { productId: products[11].id, quantity: 20 },
      ]},
    },
  });

  // REQ-006: Rejected
  await prisma.productRequest.create({
    data: {
      requestNumber: 'REQ-240412-006',
      managerId: manager1.id, unitId: unit1.id, status: 'REJECTED',
      notes: 'Extra drums for storage',
      clearanceNotes: 'Rejected — drums available in warehouse B, please check there first',
      clearedById: storeManager.id,
      clearedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      items: { create: [
        { productId: products[23].id, quantity: 10 },
      ]},
    },
  });

  console.log('6 MIV requests created (2 collected, 1 approved, 2 pending, 1 rejected)');

  // ═══════════════════════════════════════════
  //  PURCHASE REQUESTS
  // ═══════════════════════════════════════════

  // PR-001: Completed
  await prisma.purchaseRequest.create({
    data: {
      requestNumber: 'PR-240401-001',
      managerId: manager1.id, unitId: unit1.id, status: 'COMPLETED',
      notes: 'Chemicals for upcoming tender batch',
      adminNotes: 'Approved. Reduced caustic soda qty — enough in stock for now.',
      adminApprovedById: admin.id,
      adminApprovedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      items: { create: [
        { productId: products[0].id, productName: 'Sodium Hydroxide (Caustic Soda)', productUnit: 'kg', requestedQty: 1000, adminApprovedQty: 500, purchasedQty: 500 },
        { productId: products[1].id, productName: 'Hydrochloric Acid (35%)', productUnit: 'litre', requestedQty: 300, adminApprovedQty: 300, purchasedQty: 300 },
      ]},
    },
  });

  // PR-002: In progress (partially purchased)
  await prisma.purchaseRequest.create({
    data: {
      requestNumber: 'PR-240408-002',
      managerId: manager2.id, unitId: unit2.id, status: 'IN_PROGRESS',
      notes: 'Polymer resupply — running low on HDPE',
      adminNotes: 'Approved in full. Get quotes from at least 2 vendors.',
      adminApprovedById: admin.id,
      adminApprovedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      items: { create: [
        { productId: products[5].id, productName: 'Polyethylene Granules (HDPE)', productUnit: 'kg', requestedQty: 2000, adminApprovedQty: 2000, purchasedQty: 800 },
        { productId: products[6].id, productName: 'Polypropylene Resin', productUnit: 'kg', requestedQty: 500, adminApprovedQty: 500, purchasedQty: 0 },
        { productId: products[7].id, productName: 'PVC Compound', productUnit: 'kg', requestedQty: 300, adminApprovedQty: 300, purchasedQty: 300 },
      ]},
    },
  });

  // PR-003: Approved (not yet started by PO)
  await prisma.purchaseRequest.create({
    data: {
      requestNumber: 'PR-240412-003',
      managerId: manager3.id, unitId: unit3.id, status: 'APPROVED',
      notes: 'Steel for fabrication workshop',
      adminNotes: 'Approved. Priority: MS plates first.',
      adminApprovedById: admin.id,
      adminApprovedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      items: { create: [
        { productId: products[8].id, productName: 'Mild Steel Plates (6mm)', productUnit: 'pcs', requestedQty: 50, adminApprovedQty: 50, purchasedQty: 0 },
        { productId: products[9].id, productName: 'SS 304 Round Bar', productUnit: 'meter', requestedQty: 30, adminApprovedQty: 30, purchasedQty: 0 },
        { productId: products[10].id, productName: 'Galvanized Iron Sheets', productUnit: 'pcs', requestedQty: 40, adminApprovedQty: 40, purchasedQty: 0 },
        { productId: products[11].id, productName: 'MS Angle (50x50x5)', productUnit: 'meter', requestedQty: 60, adminApprovedQty: 50, purchasedQty: 0 },
      ]},
    },
  });

  // PR-004: Pending admin approval
  await prisma.purchaseRequest.create({
    data: {
      requestNumber: 'PR-240415-004',
      managerId: manager1.id, unitId: unit1.id, status: 'PENDING_ADMIN',
      notes: 'Consumables running low across all units',
      items: { create: [
        { productName: 'Welding Electrodes (3.15mm)', productUnit: 'box', requestedQty: 50 },
        { productName: 'Grinding Discs (125mm)', productUnit: 'pcs', requestedQty: 200 },
        { productName: 'Safety Gloves (Nitrile)', productUnit: 'box', requestedQty: 40 },
        { productName: 'Cutting Wheels (355mm)', productUnit: 'pcs', requestedQty: 80 },
      ]},
    },
  });

  // PR-005: Pending admin approval
  await prisma.purchaseRequest.create({
    data: {
      requestNumber: 'PR-240416-005',
      managerId: manager2.id, unitId: unit2.id, status: 'PENDING_ADMIN',
      notes: 'Lubricants and electrical supplies needed for annual maintenance',
      items: { create: [
        { productName: 'Hydraulic Oil (ISO 68)', productUnit: 'litre', requestedQty: 400 },
        { productName: 'Gear Oil (EP 220)', productUnit: 'litre', requestedQty: 150 },
        { productName: 'Copper Wire (2.5 sq mm)', productUnit: 'meter', requestedQty: 500 },
        { productName: 'Cable Ties (300mm)', productUnit: 'box', requestedQty: 30 },
      ]},
    },
  });

  // PR-006: Rejected
  await prisma.purchaseRequest.create({
    data: {
      requestNumber: 'PR-240410-006',
      managerId: manager1.id, unitId: unit1.id, status: 'REJECTED',
      notes: 'Extra packaging materials for export batch',
      adminNotes: 'Rejected — we have 3 months of packaging stock. Re-request if stock drops below min.',
      adminApprovedById: admin.id,
      adminApprovedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
      items: { create: [
        { productName: 'HDPE Drums (200L)', productUnit: 'pcs', requestedQty: 100 },
        { productName: 'Corrugated Boxes (Large)', productUnit: 'pcs', requestedQty: 500 },
      ]},
    },
  });

  console.log('6 purchase requests created (1 completed, 1 in-progress, 1 approved, 2 pending, 1 rejected)');

  // ═══════════════════════════════════════════
  //  AUDIT LOGS
  // ═══════════════════════════════════════════
  const now = Date.now();
  const auditEntries = [
    { userId: storeManager.id, action: 'CREATE', entity: 'Product', details: { name: 'Sodium Hydroxide', sku: 'RAPS-CHEM-001' }, createdAt: new Date(now - 14 * 86400000) },
    { userId: storeManager.id, action: 'CREATE', entity: 'InwardEntry', details: { product: 'Sodium Hydroxide', qty: 520, batch: 'Initial' }, createdAt: new Date(now - 14 * 86400000) },
    { userId: manager1.id, action: 'CREATE', entity: 'ProductRequest', details: { requestNumber: 'REQ-240401-001', unit: 'UNIT-1', items: 2 }, createdAt: new Date(now - 8 * 86400000) },
    { userId: storeManager.id, action: 'APPROVE', entity: 'ProductRequest', details: { requestNumber: 'REQ-240401-001', action: 'APPROVED' }, createdAt: new Date(now - 7 * 86400000) },
    { userId: manager1.id, action: 'COLLECT', entity: 'ProductRequest', details: { requestNumber: 'REQ-240401-001', action: 'COLLECTED' }, createdAt: new Date(now - 6 * 86400000) },
    { userId: manager2.id, action: 'CREATE', entity: 'ProductRequest', details: { requestNumber: 'REQ-240405-002', unit: 'UNIT-2', items: 2 }, createdAt: new Date(now - 6 * 86400000) },
    { userId: storeManager.id, action: 'APPROVE', entity: 'ProductRequest', details: { requestNumber: 'REQ-240405-002', action: 'APPROVED (partial)' }, createdAt: new Date(now - 5 * 86400000) },
    { userId: manager1.id, action: 'CREATE', entity: 'PurchaseRequest', details: { requestNumber: 'PR-240401-001', unit: 'UNIT-1', items: 2 }, createdAt: new Date(now - 12 * 86400000) },
    { userId: admin.id, action: 'ADMIN_APPROVE', entity: 'PurchaseRequest', details: { requestNumber: 'PR-240401-001', action: 'APPROVED' }, createdAt: new Date(now - 10 * 86400000) },
    { userId: purchaseOfficer.id, action: 'RECORD_PURCHASE', entity: 'PurchaseRequest', details: { requestNumber: 'PR-240401-001', status: 'COMPLETED' }, createdAt: new Date(now - 7 * 86400000) },
    { userId: manager2.id, action: 'CREATE', entity: 'PurchaseRequest', details: { requestNumber: 'PR-240408-002', unit: 'UNIT-2', items: 3 }, createdAt: new Date(now - 7 * 86400000) },
    { userId: admin.id, action: 'ADMIN_APPROVE', entity: 'PurchaseRequest', details: { requestNumber: 'PR-240408-002', action: 'APPROVED' }, createdAt: new Date(now - 5 * 86400000) },
    { userId: purchaseOfficer.id, action: 'RECORD_PURCHASE', entity: 'PurchaseRequest', details: { requestNumber: 'PR-240408-002', status: 'IN_PROGRESS', note: 'HDPE partially delivered' }, createdAt: new Date(now - 2 * 86400000) },
    { userId: storeManager.id, action: 'CREATE', entity: 'InwardEntry', details: { product: 'HDPE Granules', qty: 300, batch: 'BATCH-HD-2604' }, createdAt: new Date(now - 4 * 86400000) },
    { userId: storeManager.id, action: 'CREATE', entity: 'InwardEntry', details: { product: 'MS Plates', qty: 15, batch: 'BATCH-MS-2604' }, createdAt: new Date(now - 3 * 86400000) },
    { userId: storeManager.id, action: 'CREATE', entity: 'StockAdjustment', details: { product: 'HDPE Drums', qty: -2, reason: 'Damaged in transit' }, createdAt: new Date(now - 3 * 86400000) },
    { userId: manager1.id, action: 'CREATE', entity: 'PurchaseRequest', details: { requestNumber: 'PR-240415-004', unit: 'UNIT-1', items: 4 }, createdAt: new Date(now - 1 * 86400000) },
    { userId: manager2.id, action: 'CREATE', entity: 'PurchaseRequest', details: { requestNumber: 'PR-240416-005', unit: 'UNIT-2', items: 4 }, createdAt: new Date(now - 0.5 * 86400000) },
  ];
  for (const entry of auditEntries) {
    await prisma.auditLog.create({ data: entry });
  }
  console.log(`${auditEntries.length} audit log entries created`);

  // ═══════════════════════════════════════════
  //  NOTIFICATIONS
  // ═══════════════════════════════════════════
  const notifications = [
    // Low stock alerts
    { type: 'LOW_STOCK', title: 'LOW STOCK: Sulphuric Acid (98%)', message: 'Sulphuric Acid (98%) (RAPS-CHEM-003) stock is at 75 litre. Minimum level: 100.', productId: products[2].id, targetRole: 'STORE_MANAGER', createdAt: new Date(now - 2 * 86400000) },
    { type: 'LOW_STOCK', title: 'LOW STOCK: Safety Gloves (Nitrile)', message: 'Safety Gloves (RAPS-CON-003) stock is at 22 box. Minimum level: 15. Running low.', productId: products[17].id, targetRole: 'STORE_MANAGER', createdAt: new Date(now - 1 * 86400000) },

    // MIV request notifications
    { type: 'NEW_REQUEST', title: 'New Request: REQ-240415-004', message: 'unit 1 (Unit-1) has submitted a new product request with 3 item(s).', targetRole: 'STORE_MANAGER', sentById: manager1.id, createdAt: new Date(now - 1 * 86400000) },
    { type: 'NEW_REQUEST', title: 'New Request: REQ-240416-005', message: 'unit 2 (Unit-2) has submitted a new product request with 3 item(s).', targetRole: 'STORE_MANAGER', sentById: manager2.id, createdAt: new Date(now - 0.5 * 86400000) },
    { type: 'REQUEST_APPROVED', title: 'Request REQ-240410-003 Approved', message: 'Your product request REQ-240410-003 has been approved. You can now collect the items.', targetRole: 'MANAGER', sentById: storeManager.id, createdAt: new Date(now - 1 * 86400000) },

    // Purchase request notifications
    { type: 'NEW_PURCHASE_REQUEST', title: 'New Purchase Request: PR-240415-004', message: 'unit 1 (Unit-1) has submitted a purchase request with 4 item(s) for admin approval.', targetRole: 'ADMIN', sentById: manager1.id, createdAt: new Date(now - 1 * 86400000) },
    { type: 'NEW_PURCHASE_REQUEST', title: 'New Purchase Request: PR-240416-005', message: 'unit 2 (Unit-2) has submitted a purchase request with 4 item(s) for admin approval.', targetRole: 'ADMIN', sentById: manager2.id, createdAt: new Date(now - 0.5 * 86400000) },
    { type: 'NEW_PURCHASE_ASSIGNMENT', title: 'New Purchase Assignment: PR-240412-003', message: 'Purchase request PR-240412-003 from unit 3 (Unit-3) has been approved. Please proceed with procurement.', targetRole: 'PURCHASE_OFFICER', sentById: admin.id, createdAt: new Date(now - 2 * 86400000) },
    { type: 'PURCHASE_COMPLETED', title: 'Purchase Complete: PR-240401-001', message: 'All items for purchase request PR-240401-001 have been fully purchased.', targetRole: 'MANAGER', sentById: purchaseOfficer.id, createdAt: new Date(now - 7 * 86400000) },
    { type: 'PURCHASE_REQUEST_REJECTED', title: 'Purchase Request PR-240410-006 Rejected', message: 'Your purchase request PR-240410-006 has been rejected. Reason: We have 3 months of packaging stock.', targetRole: 'MANAGER', sentById: admin.id, createdAt: new Date(now - 4 * 86400000) },
  ];
  for (const n of notifications) {
    await prisma.notification.create({ data: n });
  }
  console.log(`${notifications.length} notifications created`);

  // ═══════════════════════════════════════════
  //  SUMMARY
  // ═══════════════════════════════════════════
  console.log('\n══════════════════════════════════');
  console.log('  SEED COMPLETE');
  console.log('══════════════════════════════════');
  console.log(`  Products:           ${products.length}`);
  console.log(`  Stock Movements:    ${products.length + recentInwards.length + recentOutwards.length + 1}`);
  console.log(`  MIV Requests:       6`);
  console.log(`  Purchase Requests:  6`);
  console.log(`  Audit Logs:         ${auditEntries.length}`);
  console.log(`  Notifications:      ${notifications.length}`);
  console.log('══════════════════════════════════\n');
}

main()
  .catch((e) => { console.error('Seed error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
