// Import additional Excel data not yet in the ERP:
//   1. IN-2025.xlsx          (1067 calendar-2025 inwards) → StockMovement + ProductBatch
//   2. Inward Status File.xlsx "2025-26" (471 QC inspection rows) → enrich existing StockMovement notes
//   3. Systems Data.xlsx     (42 systems/equipment per unit) → Product (Asset)

const path = require('path');
const xlsx = require('xlsx');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const FOLDER = 'C:\\Users\\alaja\\Documents\\RAPS formats and stocks';

// ─── Helpers ───────────────────────────────────────────────────────────
const norm = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');

const toDate = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(d) ? null : d;
  }
  const d = new Date(v);
  return isNaN(d) ? null : d;
};

const toFloat = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const m = String(v).match(/[-+]?\d*\.?\d+/);
  return m ? parseFloat(m[0]) : null;
};

const cleanStr = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' || s === '-' ? null : s;
};

const skuFromName = (name, idx) => {
  const slug = norm(name).replace(/[^A-Z0-9]/g, '').slice(0, 20);
  return `RAPS-${slug || 'ITEM'}-${String(idx).padStart(4, '0')}`;
};

// Map Excel unit codes ("1", "1A", "2", ...) to DB unit IDs
let unitMap = {};
let defaultUnitId = null;
let defaultManagerId = null;
const productRegistry = new Map();

async function loadUsersAndUnits() {
  const units = await prisma.unit.findMany();
  const users = await prisma.user.findMany();
  for (const u of units) {
    const m = u.code.match(/^UNIT-(.+)$/i);
    if (m) unitMap[m[1].toUpperCase()] = u.id;
    unitMap[u.code.toUpperCase()] = u.id;
  }
  defaultUnitId = unitMap['1'] || units[0].id;
  if (!unitMap['1A']) unitMap['1A'] = unitMap['1'];

  const admin = users.find(u => u.role === 'ADMIN');
  defaultManagerId = admin?.id || users[0].id;
  console.log(`Defaults: managerId=${defaultManagerId}`);

  // Pre-populate productRegistry from DB
  const products = await prisma.product.findMany({ select: { id: true, name: true } });
  for (const p of products) productRegistry.set(norm(p.name), p);
  console.log(`Loaded ${products.length} existing products into registry`);
}

async function getOrCreateProduct(name, unit = 'pcs') {
  const cleaned = cleanStr(name);
  if (!cleaned) return null;
  const key = norm(cleaned);
  if (productRegistry.has(key)) return productRegistry.get(key);

  let product = await prisma.product.findFirst({ where: { name: { equals: cleaned, mode: 'insensitive' } } });
  if (!product) {
    const sku = skuFromName(cleaned, productRegistry.size + 1);
    try {
      product = await prisma.product.create({
        data: {
          name: cleaned.slice(0, 200),
          sku,
          unit: cleanStr(unit) || 'pcs',
          currentStock: 0,
        },
      });
    } catch {
      product = await prisma.product.create({
        data: {
          name: cleaned.slice(0, 200),
          sku: `${sku}-${Date.now() % 100000}`,
          unit: cleanStr(unit) || 'pcs',
          currentStock: 0,
        },
      });
    }
  }
  productRegistry.set(key, product);
  return product;
}

// ─── Step 1: Import IN-2025 inwards ─────────────────────────────────────
async function importIN2025() {
  console.log('\n[1] Importing IN-2025.xlsx INWARD-2025 sheet...');
  const wb = xlsx.readFile(path.join(FOLDER, 'IN-2025.xlsx'));
  const ws = wb.Sheets['INWARD-2025'];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: null });
  // Header at row 2 (index 2):
  // 0:IN IN NO, 1:OUR MATERIAL NO (MIR), 2:DATE, 3:VEHICLE NO,
  // 4:IN/DC/G.P TYPE, 5:IN/DC/G.P NO, 6:ITEM DESCRIPTION,
  // 7:QTY, 8:SUPPLIER, 9:type of material, 10:BATCH NO,
  // 11:EXP DT, 12:PO/PROJECT, 13:ISSUE DETAILS, 14:STORES SIGN, 15:REMARKS

  let inwardCreated = 0, errors = 0, skipped = 0;
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const itemDesc = cleanStr(r[6]);
    if (!itemDesc) { skipped++; continue; }

    const mirNoRaw = cleanStr(r[1]);
    const mirNo = mirNoRaw ? `2025-${mirNoRaw}` : null; // namespace by year
    const date = toDate(r[2]) || new Date('2025-01-01');
    const vehicle = cleanStr(r[3]);
    const docType = cleanStr(r[4]);
    const docNo = cleanStr(r[5]);
    const qty = toFloat(r[7]) || 0;
    // IN-2025 doesn't have separate UOM column — try to extract from QTY string
    const qtyRaw = cleanStr(r[7]) || '';
    const uomMatch = qtyRaw.match(/[A-Za-z]+(?:\.|$|\s)/);
    const uom = uomMatch ? uomMatch[0].replace(/\.$/, '').trim() : 'pcs';
    const supplier = cleanStr(r[8]);
    const matType = cleanStr(r[9]);
    const batchNo = cleanStr(r[10]);
    const expDt = toDate(r[11]);
    const poRef = cleanStr(r[12]);
    const issueDetails = cleanStr(r[13]);
    const remarks = cleanStr(r[15]);

    if (qty <= 0) { skipped++; continue; }

    try {
      const product = await getOrCreateProduct(itemDesc, uom);
      if (!product) { skipped++; continue; }

      const notesObj = {
        mirNo, vehicle, docType, docNo, supplier, matType,
        poRef, issueDetails, remarks,
        expiryDate: expDt ? expDt.toISOString() : null,
        source: 'IN-2025',
      };

      await prisma.$transaction([
        prisma.product.update({
          where: { id: product.id },
          data: { currentStock: { increment: qty } },
        }),
        prisma.stockMovement.create({
          data: {
            productId: product.id,
            type: 'IN',
            quantity: qty,
            referenceType: 'InwardEntry',
            referenceId: mirNo,
            batchNumber: batchNo,
            notes: JSON.stringify(notesObj),
            performedBy: defaultManagerId,
            createdAt: date,
          },
        }),
        prisma.productBatch.create({
          data: {
            productId: product.id,
            batchNo,
            receivedDate: date,
            quantity: qty,
            remaining: qty,
            referenceType: 'InwardEntry',
            referenceId: mirNo,
            notes: JSON.stringify(notesObj),
            createdById: defaultManagerId,
            createdAt: date,
          },
        }),
      ]);
      inwardCreated++;
      if (inwardCreated % 100 === 0) console.log(`  ...${inwardCreated} inwards`);
    } catch (e) {
      errors++;
      if (errors < 5) console.error(`  Inward error (row ${i+1}, MIR ${mirNo}):`, e.message.split('\n')[0]);
    }
  }
  console.log(`  Result: ${inwardCreated} inward entries, ${skipped} skipped, ${errors} errors`);
}

// ─── Step 2: Enrich StockMovement with QC status from Inward Status File ─
async function importInwardStatus() {
  console.log('\n[2] Importing Inward Status File.xlsx "2025-26" sheet...');
  const wb = xlsx.readFile(path.join(FOLDER, 'Inward Status File.xlsx'));
  const ws = wb.Sheets['2025-26'];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: null });
  // Header row 0:
  // 0:ION NO, 1:MIR No, 2:Date, 3:Type, 4:DC/GP No, 5:Item desc,
  // 6:Qty, 7:Supplier, 8:Unit, 9:Bill Type, 10:Status, 11:Remarks

  let updated = 0, created = 0, skipped = 0, errors = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const ionNo = cleanStr(r[0]);
    const mirNoRaw = cleanStr(r[1]);
    const date = toDate(r[2]);
    const docType = cleanStr(r[3]);
    const docNo = cleanStr(r[4]);
    const itemDesc = cleanStr(r[5]);
    const qty = toFloat(r[6]) || 0;
    const supplier = cleanStr(r[7]);
    const unitCode = cleanStr(r[8]);
    const billType = cleanStr(r[9]);
    const status = cleanStr(r[10]);
    const remarks = cleanStr(r[11]);

    if (!mirNoRaw && !itemDesc) { skipped++; continue; }

    // Try to find existing StockMovement with this MIR (the file is 2025-26 fiscal,
    // but our IN-2026.xlsx import already covers part of this. Prefix candidates: "2025-X" and just "X")
    const candidates = [];
    if (mirNoRaw) {
      candidates.push(`2025-${mirNoRaw}`);
      candidates.push(mirNoRaw);
    }

    let existing = null;
    if (candidates.length) {
      existing = await prisma.stockMovement.findFirst({
        where: {
          referenceType: 'InwardEntry',
          referenceId: { in: candidates },
        },
      });
    }

    try {
      if (existing) {
        // Merge inspection status into existing notes JSON
        let notesObj = {};
        try { notesObj = JSON.parse(existing.notes || '{}'); } catch {}
        notesObj.inspection = { ionNo, status, remarks, billType };
        await prisma.stockMovement.update({
          where: { id: existing.id },
          data: { notes: JSON.stringify(notesObj) },
        });
        updated++;
      } else if (itemDesc && qty > 0) {
        // No matching MIR — create a fresh record so the data isn't lost
        const product = await getOrCreateProduct(itemDesc, 'pcs');
        if (!product) { skipped++; continue; }
        const refId = mirNoRaw ? `STATUS-${mirNoRaw}` : `STATUS-ION-${ionNo || i}`;
        const unitId = unitCode ? (unitMap[unitCode.toUpperCase().replace(/^UNIT[-\s]?/i, '')] || unitMap[unitCode.toUpperCase()] || null) : null;
        const notesObj = {
          mirNo: mirNoRaw, ionNo, docType, docNo, supplier,
          unit: unitCode, billType, status, remarks,
          source: 'Inward Status File 2025-26',
        };
        await prisma.$transaction([
          prisma.product.update({
            where: { id: product.id },
            data: { currentStock: { increment: qty } },
          }),
          prisma.stockMovement.create({
            data: {
              productId: product.id,
              type: 'IN',
              quantity: qty,
              referenceType: 'InwardEntry',
              referenceId: refId,
              notes: JSON.stringify(notesObj),
              performedBy: defaultManagerId,
              unitId,
              createdAt: date || new Date('2025-04-01'),
            },
          }),
          prisma.productBatch.create({
            data: {
              productId: product.id,
              receivedDate: date || new Date('2025-04-01'),
              quantity: qty,
              remaining: qty,
              referenceType: 'InwardEntry',
              referenceId: refId,
              notes: JSON.stringify(notesObj),
              createdById: defaultManagerId,
              createdAt: date || new Date('2025-04-01'),
            },
          }),
        ]);
        created++;
      } else {
        skipped++;
      }
    } catch (e) {
      errors++;
      if (errors < 5) console.error(`  Status error (row ${i+1}, MIR ${mirNoRaw}):`, e.message.split('\n')[0]);
    }
  }
  console.log(`  Result: ${updated} enriched, ${created} created, ${skipped} skipped, ${errors} errors`);
}

// ─── Step 3: Import Systems Data as Asset products ──────────────────────
async function importSystems() {
  console.log('\n[3] Importing Systems Data.xlsx Sheet1...');
  const wb = xlsx.readFile(path.join(FOLDER, 'Systems Data.xlsx'));
  const ws = wb.Sheets['Sheet1'];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: null });
  // Header at row 1 (index 1):
  // 0:Unit Details, 1:System Type, 2:Qty, 3:UOM, 4:Company Name, 5:Remarks
  // Unit Details cell empty = inherit previous unit

  let created = 0, skipped = 0, errors = 0;
  let currentUnit = null;
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const unitDetails = cleanStr(r[0]);
    const sysType = cleanStr(r[1]);
    const qty = toFloat(r[2]) || 0;
    const uom = cleanStr(r[3]) || 'No';
    const company = cleanStr(r[4]);
    const remarks = cleanStr(r[5]);

    if (unitDetails) currentUnit = unitDetails;
    if (!sysType || qty <= 0) { skipped++; continue; }

    // Build distinctive name: "Unit-1 / Computer / Dell"
    const name = `${currentUnit || 'Unknown Unit'} - ${sysType}${company ? ' / ' + company : ''}`;
    const sku = skuFromName(name, productRegistry.size + 1);

    try {
      // Check if already in registry
      const key = norm(name);
      let product = productRegistry.get(key);
      if (!product) {
        product = await prisma.product.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
      }
      if (product) {
        // Already exists — increment stock by qty (idempotent skip if stock >= qty)
        skipped++;
        continue;
      }

      product = await prisma.product.create({
        data: {
          name: name.slice(0, 200),
          sku,
          category: 'Asset',
          unit: uom,
          currentStock: qty,
          description: remarks || null,
        },
      });
      productRegistry.set(key, product);

      // Also record an IN stock movement so audit trail exists
      const unitId = currentUnit
        ? (unitMap[currentUnit.toUpperCase().replace(/^UNIT[-\s]?/i, '').replace(/\s+/g, '')] || null)
        : null;
      await prisma.stockMovement.create({
        data: {
          productId: product.id,
          type: 'IN',
          quantity: qty,
          referenceType: 'AssetRegistration',
          referenceId: `SYS-${product.sku}`,
          notes: JSON.stringify({ company, remarks, unitDetails: currentUnit, source: 'Systems Data' }),
          performedBy: defaultManagerId,
          unitId,
        },
      });
      created++;
    } catch (e) {
      errors++;
      if (errors < 5) console.error(`  Systems error (row ${i+1}):`, e.message.split('\n')[0]);
    }
  }
  console.log(`  Result: ${created} systems added as products, ${skipped} skipped, ${errors} errors`);
}

async function main() {
  console.log('=== RAPS Excel Extras Import ===');
  await loadUsersAndUnits();
  await importIN2025();
  await importInwardStatus();
  await importSystems();

  const counts = {
    products: await prisma.product.count(),
    purchaseRequests: await prisma.purchaseRequest.count(),
    purchaseOrders: await prisma.purchaseOrder.count(),
    quotations: await prisma.quotation.count(),
    stockMovements: await prisma.stockMovement.count(),
    productBatches: await prisma.productBatch.count(),
  };
  console.log('\n=== Final counts ===');
  console.log(JSON.stringify(counts, null, 2));
}

main()
  .catch((e) => { console.error('Fatal:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
