// One-shot importer for the "Store Stock Statement" Excel file
// (C:/Users/alaja/Desktop/25-05-2026 STORE STOCK STATEMENT.xlsx).
//
// Steps:
//   1. For each stock row in sections FABRICS, SPOOLS, RESINS_HARDENERS, RUBBER,
//      SOLVENTS, CONSUMABLES_1, CONSUMABLES_2, STATIONERY:
//      - exact normalized name match against existing Product → update currentStock
//      - else create a fresh Product (auto SKU, no materialCode), category derived
//        from the section.
//   2. Create a ProductBatch row per stock entry with qty>0 (referenceType='StockStatement').
//   3. Stationery products get category='Stationery'.
//   4. FIM rows (customer property) are intentionally skipped — those belong on
//      the FIM Status / Gate Pass flow, not the products list.
//
// Run from the server folder:
//   node scripts/import-store-stock.js

const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const prisma = require('../src/config/db');
const { generateProductSku } = require('../src/utils/helpers');

// Excel path: pass as the first CLI arg, set EXCEL_PATH env var, or fall back
// to the local Windows location used during development.
const EXCEL_PATH =
  process.argv[2] ||
  process.env.EXCEL_PATH ||
  'C:/Users/alaja/Desktop/25-05-2026 STORE STOCK STATEMENT.xlsx';
const STATEMENT_DATE = new Date('2026-05-25');

// Section row positions (0-indexed) inside the Sheet2 sheet — matched by inspection.
const SECTIONS = [
  { row: 2,   key: 'FABRICS',          category: 'Raw Material' },
  { row: 27,  key: 'SPOOLS',           category: 'Raw Material' },
  { row: 32,  key: 'RESINS_HARDENERS', category: 'Raw Material' },
  { row: 69,  key: 'RUBBER',           category: 'Raw Material' },
  { row: 98,  key: 'SOLVENTS',         category: 'Raw Material' },
  { row: 105, key: 'CONSUMABLES_1',    category: 'Consumable' },
  { row: 139, key: 'CONSUMABLES_2',    category: 'Consumable' },
  { row: 182, key: 'STATIONERY',       category: 'Stationery' },
];
const FIM_START_ROW = 223;

// Normalize a UOM column to the app's preferred unit string.
function mapUnit(u) {
  const s = (u || '').toString().trim().toLowerCase().replace(/[.'"]/g, '');
  if (!s) return 'pcs';
  if (s === 'm' || s === 'mtr' || s === 'mtrs' || s === 'meter' || s === 'metre') return 'meter';
  if (s === 'kg' || s === 'kgs') return 'kg';
  if (s === 'l' || s === 'lt' || s === 'lts' || s === 'litre' || s === 'liter' || s === 'ltr') return 'litre';
  if (s === 'sqmtr' || s === 'sqm' || s === 'sq m' || s === 'sq mtr' || s === 'sq mt') return 'Sq. mtr';
  if (s === 'roll' || s === 'rolls') return 'Rolls';
  if (s === 'box' || s === 'boxes') return 'box';
  if (s === 'set' || s === 'sets') return 'set';
  if (s === 'pair' || s === 'pairs') return 'pair';
  if (s === 'pk' || s === 'pkt' || s === 'pack' || s === 'packs') return 'pack';
  if (s === 'tin' || s === 'tins') return 'tin';
  if (s === 'brls' || s === 'brl' || s === 'barrel' || s === 'barrels') return 'barrel';
  if (s === 'bundle' || s === 'bundles') return 'Bundles';
  if (s === 'bag' || s === 'bags') return 'Bags';
  if (s === 'sheet' || s === 'sheets') return 'Sheets';
  if (s === 'pa') return 'pack';
  if (s === 'no' || s === 'nos' || s === 'pcs' || s === 'pc' || s === 'piece' || s === 'pieces') return 'pcs';
  return u; // pass-through for anything else
}

function normName(s) {
  if (!s) return '';
  return String(s).toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// Excel serial date (e.g. 45567) → JS Date. Returns null if not parseable.
function excelDate(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number') {
    // Excel epoch is 1899-12-30 (accounting for the 1900 leap bug).
    const ms = (v - 25569) * 86400 * 1000;
    return new Date(ms);
  }
  if (typeof v === 'string' && v.trim() && v.trim() !== '-') {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function extractStockRows() {
  const wb = XLSX.readFile(EXCEL_PATH);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const stockRows = [];
  for (let s = 0; s < SECTIONS.length; s++) {
    const start = SECTIONS[s].row + 2; // section title row + header row + 1
    const end   = s + 1 < SECTIONS.length ? SECTIONS[s + 1].row : FIM_START_ROW;
    for (let i = start; i < end; i++) {
      const r = rows[i];
      if (!r || !r[1]) continue;
      const qtyRaw = r[2];
      let qty = null;
      if (typeof qtyRaw === 'number') qty = qtyRaw;
      else if (typeof qtyRaw === 'string') {
        const t = qtyRaw.trim();
        if (t && t !== '-' && t !== '--') {
          const n = Number(t);
          if (!isNaN(n)) qty = n;
        }
      }
      stockRows.push({
        section: SECTIONS[s].key,
        category: SECTIONS[s].category,
        name: String(r[1]).trim(),
        qty,
        uom: r[3] ? String(r[3]).trim() : null,
        batch: r[4] ? String(r[4]).trim() : null,
        dom: excelDate(r[5]),
        doe: excelDate(r[6]),
        referredUnit: r[7] ? String(r[7]).trim() : null,
        remarks: r[8] ? String(r[8]).trim() : null,
      });
    }
  }
  return stockRows;
}

async function run() {
  const stockRows = extractStockRows();
  console.log(`Loaded ${stockRows.length} stock rows from ${path.basename(EXCEL_PATH)}`);

  // Build lookup over current products by normalized name.
  const allProducts = await prisma.product.findMany({
    select: { id: true, name: true, materialCode: true, sku: true, category: true, unit: true, currentStock: true },
  });
  const byNorm = new Map();
  for (const p of allProducts) {
    const k = normName(p.name);
    if (!byNorm.has(k)) byNorm.set(k, p);
  }

  let matched = 0;
  let created = 0;
  let batches = 0;
  let skipped = 0;
  const errors = [];

  for (const sr of stockRows) {
    try {
      const key = normName(sr.name);
      if (!key) { skipped++; continue; }

      const unit = mapUnit(sr.uom);
      const qty = typeof sr.qty === 'number' ? sr.qty : 0;

      let product = byNorm.get(key) || null;

      if (product) {
        await prisma.product.update({
          where: { id: product.id },
          data: { currentStock: qty, unit: product.unit || unit, category: product.category || sr.category },
        });
        matched++;
      } else {
        const sku = await generateProductSku(prisma, sr.category);
        product = await prisma.product.create({
          data: {
            name: sr.name,
            sku,
            category: sr.category,
            unit,
            currentStock: qty,
            description: sr.remarks || undefined,
          },
        });
        byNorm.set(key, product);
        created++;
      }

      // Capture batch info from the stock statement when there's stock or batch detail.
      const hasBatchDetail = sr.batch || sr.dom || sr.doe || sr.referredUnit;
      if (qty > 0 || hasBatchDetail) {
        const noteParts = [];
        if (sr.referredUnit) noteParts.push(`Referred unit: ${sr.referredUnit}`);
        if (sr.remarks) noteParts.push(sr.remarks);
        await prisma.productBatch.create({
          data: {
            productId: product.id,
            batchNo: sr.batch || null,
            receivedDate: sr.dom || STATEMENT_DATE,
            quantity: qty,
            remaining: qty,
            referenceType: 'StockStatement',
            referenceId: '25-05-2026',
            notes: noteParts.length ? noteParts.join(' | ') : null,
          },
        });
        batches++;
      }
    } catch (err) {
      errors.push({ name: sr.name, section: sr.section, message: err.message });
    }
  }

  console.log(
    `\nDone. Matched-updated: ${matched}  Created-new: ${created}  Batches created: ${batches}  Skipped: ${skipped}  Errors: ${errors.length}`,
  );
  if (errors.length) {
    console.log('\nFirst 10 errors:');
    for (const e of errors.slice(0, 10)) console.log(`  [${e.section}] ${e.name} — ${e.message}`);
  }
}

run()
  .catch((err) => {
    console.error('Import failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
