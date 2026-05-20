// Import RAPS Excel data into the ERP database.
// Sources:
//   - NEW STOCK.xlsx       (canonical product list)
//   - IN-2026.xlsx          (inward register → StockMovement + ProductBatch)
//   - PR & PO File 2026-27.xlsx, sheet "PR & PO 2025-26" (PRs + POs)

const path = require('path');
const xlsx = require('xlsx');
const { PrismaClient } = require('@prisma/client');
const {
  generateProductSku, normalizeMaterialType, isUniqueViolation,
} = require('../src/utils/helpers');

const prisma = new PrismaClient();
const FOLDER = process.env.RAPS_IMPORT_FOLDER || 'C:\\Users\\alaja\\Documents\\RAPS formats and stocks';

// ─── Helpers ───────────────────────────────────────────────────────────
const norm = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');

const toDate = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number') {
    // Excel serial date
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(d) ? null : d;
  }
  const d = new Date(v);
  return isNaN(d) ? null : d;
};

const toFloat = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  // Strip non-numeric: "100 KG" → 100
  const m = String(v).match(/[-+]?\d*\.?\d+/);
  return m ? parseFloat(m[0]) : null;
};

const cleanStr = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' || s === '-' ? null : s;
};

// Legacy slug-based SKU is no longer used — we now route through
// generateProductSku(prisma, materialType) so re-imports stay aligned with the
// canonical RAW-/CONS-/TOOL-/OTH- numbering and a single counter per prefix.

// Map Excel unit codes ("1", "1A", "2", ...) to DB unit IDs
let unitMap = {}; // "1" → uuid
let defaultUnitId = null;
let defaultManagerId = null;
let purchaseUserId = null;

// Product registry: normalized name → product record
const productRegistry = new Map();

async function loadUsersAndUnits() {
  const units = await prisma.unit.findMany();
  const users = await prisma.user.findMany();
  for (const u of units) {
    // "UNIT-1" → "1", "UNIT-1A" wouldn't exist; just store both forms
    const m = u.code.match(/^UNIT-(.+)$/i);
    if (m) unitMap[m[1].toUpperCase()] = u.id;
    unitMap[u.code.toUpperCase()] = u.id;
  }
  defaultUnitId = unitMap['1'] || units[0].id; // fallback Unit-1
  // Map "1A" → Unit-1 (no UNIT-1A in DB)
  if (!unitMap['1A']) unitMap['1A'] = unitMap['1'];

  const admin = users.find(u => u.role === 'ADMIN');
  const purchase = users.find(u => u.role === 'PURCHASE_OFFICER');
  defaultManagerId = admin?.id || users[0].id;
  purchaseUserId = purchase?.id || defaultManagerId;
  console.log(`Defaults: managerId=${defaultManagerId} purchaseId=${purchaseUserId}`);
  console.log(`Unit map keys: ${Object.keys(unitMap).join(', ')}`);
}

async function getOrCreateProduct(name, unit = 'pcs', materialType = null) {
  const cleaned = cleanStr(name);
  if (!cleaned) return null;
  const key = norm(cleaned);
  if (productRegistry.has(key)) return productRegistry.get(key);

  // Try DB lookup by name (case-insensitive). If found and the row is missing
  // a canonical category, patch it from the incoming materialType.
  let product = await prisma.product.findFirst({ where: { name: { equals: cleaned, mode: 'insensitive' } } });
  if (product) {
    const canonical = normalizeMaterialType(materialType || product.category);
    if (product.category !== canonical) {
      product = await prisma.product.update({
        where: { id: product.id },
        data: { category: canonical },
      });
    }
    productRegistry.set(key, product);
    return product;
  }

  // New product — let helpers assign the next slot in its prefix bucket.
  const category = normalizeMaterialType(materialType);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const sku = await generateProductSku(prisma, category);
      product = await prisma.product.create({
        data: {
          name: cleaned.slice(0, 200),
          sku,
          category,
          unit: cleanStr(unit) || 'pcs',
          currentStock: 0,
        },
      });
      break;
    } catch (err) {
      if (!isUniqueViolation(err) || attempt === 4) throw err;
    }
  }
  productRegistry.set(key, product);
  return product;
}

// ─── Step 1: Import products from NEW STOCK.xlsx ────────────────────────
async function importProducts() {
  console.log('\n[1] Importing products from NEW STOCK.xlsx...');
  const wb = xlsx.readFile(path.join(FOLDER, 'NEW STOCK.xlsx'));
  const ws = wb.Sheets['DB'];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: null });
  // Header at index 1: ['SL NO','ITEM DESCRIPTION','QTY','UOM','BATCH NO','DOM','DOE']
  let added = 0;
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    const name = cleanStr(r[1]);
    if (!name) continue;
    const uom = cleanStr(r[3]) || 'pcs';
    const p = await getOrCreateProduct(name, uom);
    if (p) added++;
  }
  console.log(`  Products added: ${added} (registry size: ${productRegistry.size})`);
}

// ─── Step 2: Import PRs + POs ───────────────────────────────────────────
async function importPRsAndPOs() {
  console.log('\n[2] Importing PRs and POs from PR & PO File 2026-27.xlsx...');
  const wb = xlsx.readFile(path.join(FOLDER, 'PR & PO File 2026-27.xlsx'));
  const ws = wb.Sheets['PR & PO 2025-26'];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: null });
  // Header row 0:
  // 0:PR No, 1:Date, 2:Production Unit, 3:Material, 4:Quantity, 5:UOM, 6:TYPE,
  // 7:PO No/Cash purchase, 8:PO DATE, 9:ITEM DESCRIPTION, 10:QTY, 11:UOM,
  // 12:MATERIAL TYPE, 13:Amount, 14:SUPPLIER NAME, 15:MIR No, 16:Date,
  // 17:Inward, 18:UOM, 19:Voucher No, 20:Date, 21:Qty, 22:UOM, 23:Unit,
  // 24:Name, 25:Remarks

  // Group by PR No (string) — accumulate items
  const prMap = new Map(); // prKey → { prNo, date, unit, items: [...] }
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const prNo = cleanStr(r[0]);
    if (!prNo) continue;
    const prDate = toDate(r[1]);
    const unitCode = cleanStr(r[2]);
    const material = cleanStr(r[3]);
    if (!material) continue;
    const reqQty = toFloat(r[4]) || 0;
    const reqUom = cleanStr(r[5]) || 'pcs';
    const prType = cleanStr(r[6]);
    const poNoRaw = cleanStr(r[7]);
    const poDate = toDate(r[8]);
    const poItemDesc = cleanStr(r[9]);
    const poQty = toFloat(r[10]) || 0;
    const poUom = cleanStr(r[11]) || reqUom;
    const matType = cleanStr(r[12]);
    const amount = toFloat(r[13]) || 0;
    const supplier = cleanStr(r[14]);
    const remarks = cleanStr(r[25]);

    const key = `${prNo}|${prDate ? prDate.toISOString().slice(0, 10) : ''}`;
    if (!prMap.has(key)) {
      prMap.set(key, { prNo, prDate, unitCode, items: [], pos: new Map() });
    }
    const prRec = prMap.get(key);

    // PR item
    prRec.items.push({
      productName: material,
      productUnit: reqUom,
      requestedQty: reqQty,
      materialType: matType,
      itemRemarks: remarks,
    });

    // PO grouping (if not cash purchase / hold / adjustment / blank)
    const skipPo = !poNoRaw || /^(cash purchase|hold|adjustment|-)$/i.test(poNoRaw);
    if (!skipPo) {
      const poKey = `${poNoRaw}|${poDate ? poDate.toISOString().slice(0, 10) : ''}|${supplier || ''}`;
      if (!prRec.pos.has(poKey)) {
        prRec.pos.set(poKey, {
          poNo: poNoRaw,
          poDate,
          supplier: supplier || 'Unknown Supplier',
          items: [],
          totalAmount: 0,
        });
      }
      const poRec = prRec.pos.get(poKey);
      poRec.items.push({
        productName: poItemDesc || material,
        productUnit: poUom,
        quantity: poQty,
        unitPrice: poQty > 0 ? amount / poQty : 0,
        totalPrice: amount,
      });
      poRec.totalAmount += amount;
    }
  }

  console.log(`  Grouped: ${prMap.size} PRs`);

  let prCreated = 0, poCreated = 0, errors = 0;
  let idx = 0;
  for (const [key, prRec] of prMap) {
    idx++;
    try {
      const unitId = unitMap[(prRec.unitCode || '').toUpperCase()] || defaultUnitId;
      const requestNumber = `PR-25-26-${String(idx).padStart(5, '0')}`;
      const requestId = String(prRec.prNo);

      // Pre-resolve products for items — pass materialType so the SKU prefix
      // and Product.category line up with the canonical RAW/CONS/TOOL/OTH list.
      const itemsData = [];
      for (const it of prRec.items) {
        const product = await getOrCreateProduct(it.productName, it.productUnit, it.materialType);
        itemsData.push({
          productId: product?.id || null,
          productName: it.productName.slice(0, 500),
          productUnit: it.productUnit.slice(0, 50),
          requestedQty: it.requestedQty,
          materialType: it.materialType,
          itemRemarks: it.itemRemarks?.slice(0, 500) || null,
        });
      }

      const status = prRec.pos.size > 0 ? 'ORDER_PLACED' : 'APPROVED';

      const pr = await prisma.purchaseRequest.create({
        data: {
          requestNumber,
          requestId,
          managerId: defaultManagerId,
          unitId,
          status,
          adminApprovedById: defaultManagerId,
          adminApprovedAt: prRec.prDate || new Date(),
          createdAt: prRec.prDate || new Date(),
          items: { create: itemsData },
        },
      });
      prCreated++;

      // Create POs (with stub quotations) for this PR
      let poIdx = 0;
      for (const [poKey, poRec] of prRec.pos) {
        poIdx++;
        try {
          const quotationNumber = `Q-${requestNumber}-${poIdx}`;
          const orderNumber = `PO-25-26-${String(prCreated).padStart(5, '0')}-${poIdx}`;

          // Stub quotation
          const quotation = await prisma.quotation.create({
            data: {
              quotationNumber,
              purchaseRequestId: pr.id,
              supplierName: poRec.supplier,
              totalAmount: poRec.totalAmount,
              isSelected: true,
              createdById: purchaseUserId,
              createdAt: poRec.poDate || prRec.prDate || new Date(),
              items: {
                create: poRec.items.map(it => ({
                  productName: it.productName.slice(0, 500),
                  productUnit: it.productUnit.slice(0, 50),
                  quantity: it.quantity,
                  unitPrice: it.unitPrice,
                  totalPrice: it.totalPrice,
                  supplierName: poRec.supplier,
                })),
              },
            },
          });

          await prisma.purchaseOrder.create({
            data: {
              orderNumber,
              customName: `PO ${poRec.poNo}`,
              purchaseRequestId: pr.id,
              quotationId: quotation.id,
              supplierName: poRec.supplier,
              totalAmount: poRec.totalAmount,
              status: 'COMPLETED',
              createdById: purchaseUserId,
              createdAt: poRec.poDate || prRec.prDate || new Date(),
              items: {
                create: poRec.items.map(it => ({
                  productName: it.productName.slice(0, 500),
                  productUnit: it.productUnit.slice(0, 50),
                  quantity: it.quantity,
                  unitPrice: it.unitPrice,
                  totalPrice: it.totalPrice,
                  itemStatus: 'RECEIVED',
                })),
              },
            },
          });
          poCreated++;
        } catch (poErr) {
          console.error(`    PO error for ${poRec.poNo}:`, poErr.message.split('\n')[0]);
          errors++;
        }
      }

      if (idx % 50 === 0) console.log(`  ...processed ${idx} PRs (${prCreated} PRs, ${poCreated} POs)`);
    } catch (e) {
      console.error(`  PR error (${prRec.prNo}):`, e.message.split('\n')[0]);
      errors++;
    }
  }
  console.log(`  Result: ${prCreated} PRs, ${poCreated} POs, ${errors} errors`);
}

// ─── Step 3: Import inward entries from IN-2026.xlsx ────────────────────
async function importInward() {
  console.log('\n[3] Importing inward entries from IN-2026.xlsx...');
  const wb = xlsx.readFile(path.join(FOLDER, 'IN-2026.xlsx'));
  const ws = wb.Sheets['INWARD-2026'];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: null });
  // Header row 0:
  // 0:IN IN NO, 1:OUR MATERIAL NO (MIR), 2:DATE, 3:VEHICLE NO,
  // 4:IN/DC/G.P TYPE, 5:IN/DC/G.P NO, 6:ITEM DESCRIPTION,
  // 7:QTY, 8:UOM, 9:SUPPLIER, 10:Type of material, 11:BATCH NO,
  // 12:EXP DT, 13:PO/PROJECT, 14:ISSUE DETAILS, 15:STORES SIGN, 16:REMARKS

  let inwardCreated = 0, errors = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const itemDesc = cleanStr(r[6]);
    if (!itemDesc) continue;

    const inIrNo = cleanStr(r[0]);
    const mirNo = cleanStr(r[1]);
    const date = toDate(r[2]) || new Date();
    const vehicle = cleanStr(r[3]);
    const docType = cleanStr(r[4]);
    const docNo = cleanStr(r[5]);
    const qty = toFloat(r[7]) || 0;
    const uom = cleanStr(r[8]) || 'pcs';
    const supplier = cleanStr(r[9]);
    const matType = cleanStr(r[10]);
    const batchNo = cleanStr(r[11]);
    const expDt = toDate(r[12]);
    const poRef = cleanStr(r[13]);
    const issueDetails = cleanStr(r[14]);
    const remarks = cleanStr(r[16]);

    if (qty <= 0) continue;

    try {
      const product = await getOrCreateProduct(itemDesc, uom, matType);
      if (!product) continue;

      const notesObj = {
        mirNo, vehicle, docType, docNo, supplier, matType,
        poRef, issueDetails, remarks,
        expiryDate: expDt ? expDt.toISOString() : null,
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
  console.log(`  Result: ${inwardCreated} inward entries, ${errors} errors`);
}

async function main() {
  // CLI flags let ops re-run just the products step against a fresh stock sheet
  // without re-importing PR/PO/inward history. Examples:
  //   node prisma/import-excel.js --products-only
  //   node prisma/import-excel.js --skip-pr --skip-inward
  const argv = process.argv.slice(2);
  const productsOnly = argv.includes('--products-only');
  const skipPr = productsOnly || argv.includes('--skip-pr');
  const skipInward = productsOnly || argv.includes('--skip-inward');

  console.log('=== RAPS Excel Import ===');
  if (productsOnly) console.log('Mode: PRODUCTS-ONLY (PR/PO + inward steps skipped)');
  await loadUsersAndUnits();
  await importProducts();
  if (!skipPr) await importPRsAndPOs();
  if (!skipInward) await importInward();

  // Final counts
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
