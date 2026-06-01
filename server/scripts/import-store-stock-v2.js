// V2 importer for the "Store Stock Statement" Excel file.
//
// Differences from v1:
//   • Anchors on the canonical materialCode from Material Details (material-details.json).
//   • Multi-variant stock rows mapped to one MD base get letter suffixes:
//       1003 → 1003A, 1003B, 1003C, ...
//   • Stock rows that match no MD base are assigned a fresh canonical numeric code
//     in the appropriate range (Raw 2700+, Consumable 3200+, Stationery 3600+).
//   • DOM / DOE / batchNo / referred-unit captured via a lightweight QCInspection
//     linked to the ProductBatch (no PO required — schema relaxed to allow this).
//   • REFERRED UNIT column → ProductUnitStock allocation for the named unit.
//
// Dry-run by default: pass --commit to actually mutate the DB.
//   node scripts/import-store-stock-v2.js [excelPath] [--commit]

const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const prisma = require('../src/config/db');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const excelPathArg = args.find((a) => !a.startsWith('--'));
const EXCEL_PATH =
  excelPathArg ||
  process.env.EXCEL_PATH ||
  'C:/Users/alaja/Desktop/25-05-2026 STORE STOCK STATEMENT.xlsx';
const MD_JSON = path.join(__dirname, 'material-details.json');
const STATEMENT_DATE = new Date('2026-05-25');
const STATEMENT_REF = '25-05-2026';

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

// Next-available code starting points for novel products per category.
const NOVEL_CODE_START = {
  'Raw Material': 2700,
  Consumable: 3200,
  Stationery: 3600,
  'Tools & Fixtures': 50,
  'Hand Tools & Fastners': 100,
  Others: 9000,
};

const STOPWORDS = new Set([
  'the', 'and', 'with', 'for', 'of', 'in', 'on', 'a', 'an', 'or', 'to',
  'type', 'grade', 'class', 'series', 'mm', 'cm', 'm', 'mtr', 'mtrs', 'kg', 'kgs', 'lt', 'lts', 'l',
]);

function normName(s) {
  if (!s) return '';
  return String(s).toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function tokens(s) {
  return normName(s).split(' ').filter((t) => t && !STOPWORDS.has(t));
}

function mapUnit(u) {
  const s = (u || '').toString().trim().toLowerCase().replace(/[.'"]/g, '');
  if (!s || s === '-' || s === '--' || s === 'na') return 'pcs';
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
  return u;
}

function excelDate(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number') {
    const ms = (v - 25569) * 86400 * 1000;
    return new Date(ms);
  }
  if (typeof v === 'string' && v.trim() && v.trim() !== '-') {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

// Build flexible unit-code keys: "UNIT-1", "Unit 1", "U1" all map to "UNIT-1".
function normUnitRef(s) {
  if (!s) return null;
  const k = String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!k) return null;
  // common forms: U1, UNIT1, UNIT1A → UNIT-1, UNIT-1A
  const m = k.match(/^U(?:NIT)?(\d+[A-Z]?)$/);
  if (m) return `UNIT-${m[1]}`;
  return k;
}

function extractStockRows() {
  const wb = XLSX.readFile(EXCEL_PATH);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const out = [];
  for (let s = 0; s < SECTIONS.length; s++) {
    const start = SECTIONS[s].row + 2;
    const end = s + 1 < SECTIONS.length ? SECTIONS[s + 1].row : FIM_START_ROW;
    for (let i = start; i < end; i++) {
      const r = rows[i];
      if (!r || !r[1]) continue;
      let qty = null;
      const qtyRaw = r[2];
      if (typeof qtyRaw === 'number') qty = qtyRaw;
      else if (typeof qtyRaw === 'string') {
        const t = qtyRaw.trim();
        if (t && t !== '-' && t !== '--') {
          const n = Number(t);
          if (!isNaN(n)) qty = n;
        }
      }
      out.push({
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
  return out;
}

// Pick the best MD product for a stock row. Strict matching:
//   - exact normalized name match, OR
//   - stock name contains every meaningful token from MD name
//     (i.e. stock is a specialization/variant of MD).
// We deliberately do NOT match when MD is a superset of stock, because that
// would let "Pan based carbon fabric (Tangent)" be grouped under
// "Rayon based carbon fabric" when only the generic tokens overlap.
function matchToMD(stockRow, mdIndex, allowedCategories) {
  const stockTokens = new Set(tokens(stockRow.name));
  if (stockTokens.size === 0) return null;
  const stockNorm = normName(stockRow.name);

  let best = null;
  for (const md of mdIndex) {
    if (!allowedCategories.includes(md.mappedCategory)) continue;
    const mdTokens = md.tokenSet;
    if (mdTokens.size === 0) continue;

    if (md.normName === stockNorm) return { mdRow: md, score: 1.0, reason: 'exact' };

    let allPresent = true;
    for (const t of mdTokens) if (!stockTokens.has(t)) { allPresent = false; break; }
    if (!allPresent) continue;

    // Among ties, prefer the MD with the most tokens (most-specific anchor).
    const score = mdTokens.size;
    if (!best || score > best.score) best = { mdRow: md, score, reason: 'stockContainsMD' };
  }
  return best;
}

// Map MD's Excel "type" string to our canonical category.
function mdMappedCategory(t) {
  const v = (t || '').toLowerCase();
  if (v === 'raw material') return 'Raw Material';
  if (v === 'consumable' || v === 'consumables') return 'Consumable';
  if (v === 'capital') return 'Tools & Fixtures';
  if (v === 'stationery' || v === 'stationary') return 'Stationery';
  return 'Others';
}

async function run() {
  console.log(`Mode: ${COMMIT ? 'COMMIT (will write to DB)' : 'DRY-RUN (no DB writes)'}`);
  console.log(`Excel: ${EXCEL_PATH}`);

  const mdRaw = JSON.parse(fs.readFileSync(MD_JSON, 'utf8'));
  const mdIndex = mdRaw.map((m) => ({
    materialCode: String(m.materialCode),
    name: m.name,
    normName: normName(m.name),
    tokenSet: new Set(tokens(m.name)),
    mappedCategory: mdMappedCategory(m.type),
  }));
  console.log(`Loaded ${mdIndex.length} MD products.`);

  const stockRows = extractStockRows();
  console.log(`Loaded ${stockRows.length} stock rows.`);

  // Group stock rows by matched MD base code.
  const groups = new Map(); // baseCode -> [stockRow]
  const novel = []; // stockRows with no MD match

  for (const sr of stockRows) {
    const allowed = sr.category === 'Stationery'
      ? ['Stationery']
      : sr.category === 'Consumable'
        ? ['Consumable', 'Tools & Fixtures', 'Others']
        : ['Raw Material', 'Consumable', 'Others'];
    const m = matchToMD(sr, mdIndex, allowed);
    if (m) {
      const code = m.mdRow.materialCode;
      if (!groups.has(code)) groups.set(code, []);
      groups.get(code).push({ ...sr, mdMatch: m });
    } else {
      novel.push(sr);
    }
  }

  // Determine next available numeric codes per category (excluding MD-used codes).
  const usedCodes = new Set(mdIndex.map((m) => +m.materialCode));
  // Also pull DB-used codes so we don't collide on re-run.
  const dbProds = await prisma.product.findMany({ select: { materialCode: true } });
  for (const p of dbProds) if (p.materialCode && /^\d+/.test(p.materialCode)) usedCodes.add(+p.materialCode.replace(/[A-Z]+$/, ''));

  const nextCode = { ...NOVEL_CODE_START };
  function nextNovelCode(category) {
    let c = nextCode[category] ?? 9000;
    while (usedCodes.has(c)) c++;
    usedCodes.add(c);
    nextCode[category] = c + 1;
    return String(c);
  }

  // Build assignment plan.
  const plan = []; // { stockRow, finalCode, isNew, mdBaseName }

  for (const [baseCode, rows] of groups.entries()) {
    if (rows.length === 1) {
      plan.push({ stockRow: rows[0], finalCode: baseCode, isNewProduct: false, mdBaseName: rows[0].mdMatch.mdRow.name });
    } else {
      for (let i = 0; i < rows.length; i++) {
        const suffix = String.fromCharCode(65 + i); // A, B, C, ...
        plan.push({
          stockRow: rows[i],
          finalCode: `${baseCode}${suffix}`,
          isNewProduct: true,
          mdBaseName: rows[i].mdMatch.mdRow.name,
        });
      }
    }
  }
  for (const sr of novel) {
    const code = nextNovelCode(sr.category);
    plan.push({ stockRow: sr, finalCode: code, isNewProduct: true, mdBaseName: null });
  }

  // Cache existing products + units.
  const allProducts = await prisma.product.findMany({
    select: { id: true, materialCode: true, name: true, unit: true, category: true, currentStock: true },
  });
  const byCode = new Map();
  const byNormName = new Map();
  for (const p of allProducts) {
    if (p.materialCode) byCode.set(p.materialCode, p);
    byNormName.set(normName(p.name), p);
  }

  // Re-bind any novel plan items whose product was already created on a prior
  // run (looked up by normalized name) so the second run is idempotent.
  for (const item of plan) {
    if (item.mdBaseName) continue; // matched or suffixed — already keyed by code
    const existing = byNormName.get(normName(item.stockRow.name));
    if (existing && existing.materialCode && !byCode.has(item.finalCode)) {
      // Replace the freshly-chosen finalCode with whatever was assigned before.
      item.finalCode = existing.materialCode;
    }
  }

  const allUnits = await prisma.unit.findMany({ select: { id: true, name: true, code: true } });
  const unitByKey = new Map();
  for (const u of allUnits) {
    unitByKey.set(normUnitRef(u.code), u);
    unitByKey.set(normUnitRef(u.name), u);
  }

  let stats = { matched: 0, suffixed: 0, novelCreated: 0, batchesCreated: 0, qcCreated: 0, unitAllocations: 0, skipped: 0, errors: 0 };
  const errors = [];

  for (const item of plan) {
    const { stockRow: sr, finalCode } = item;
    try {
      const unit = mapUnit(sr.uom);
      const qty = typeof sr.qty === 'number' ? sr.qty : 0;
      const existing = byCode.get(finalCode);

      // Build description blending MD usage + remarks.
      const desc = sr.remarks || undefined;

      let productId;
      if (existing) {
        if (COMMIT) {
          await prisma.product.update({
            where: { id: existing.id },
            data: {
              name: sr.name,
              category: existing.category || sr.category,
              unit: existing.unit || unit,
              currentStock: qty,
              description: desc ?? undefined,
            },
          });
        }
        productId = existing.id;
        stats.matched++;
        if (item.isNewProduct) stats.suffixed++;
      } else {
        if (COMMIT) {
          const created = await prisma.product.create({
            data: {
              materialCode: finalCode,
              name: sr.name,
              sku: finalCode,
              category: sr.category,
              unit,
              currentStock: qty,
              description: desc,
            },
          });
          productId = created.id;
          byCode.set(finalCode, created);
        } else {
          productId = `dry:${finalCode}`;
        }
        if (item.mdBaseName) stats.suffixed++;
        else stats.novelCreated++;
      }

      // Create synthetic QCInspection for this batch (carries DOM/DOE/batchNo).
      let qcId = null;
      const hasQcData = sr.batch || sr.dom || sr.doe;
      if (COMMIT && (qty > 0 || hasQcData)) {
        const ionNo = `SS-${STATEMENT_REF}-${finalCode}`;
        const qc = await prisma.qCInspection.upsert({
          where: { inspectionNumber: ionNo },
          update: {
            batchNo: sr.batch || null,
            dateOfManufacturing: sr.dom || null,
            dateOfExpiry: sr.doe || null,
            qtyReceived: qty,
            qtyAccepted: qty,
            qtyRejected: 0,
            remarks: sr.remarks || null,
            notes: sr.referredUnit ? `Referred unit: ${sr.referredUnit}` : null,
          },
          create: {
            inspectionNumber: ionNo,
            purchaseOrderId: null,
            result: 'PASSED',
            batchNo: sr.batch || null,
            dateOfManufacturing: sr.dom || null,
            dateOfExpiry: sr.doe || null,
            materialReceiptDate: STATEMENT_DATE,
            materialCategory: sr.category,
            materialDescription: sr.name,
            qtyReceived: qty,
            qtyAccepted: qty,
            qtyRejected: 0,
            remarks: sr.remarks || null,
            notes: sr.referredUnit ? `Referred unit: ${sr.referredUnit}` : null,
          },
        });
        qcId = qc.id;
        stats.qcCreated++;
      }

      if (qty > 0 || sr.batch || sr.dom || sr.doe) {
        if (COMMIT) {
          // Idempotent: one batch per (product, statement). Update if it exists.
          const existingBatch = await prisma.productBatch.findFirst({
            where: { productId, referenceType: 'StockStatement', referenceId: STATEMENT_REF },
            select: { id: true },
          });
          if (existingBatch) {
            await prisma.productBatch.update({
              where: { id: existingBatch.id },
              data: {
                batchNo: sr.batch || null,
                receivedDate: STATEMENT_DATE,
                quantity: qty,
                remaining: qty,
                sourceQcInspectionId: qcId,
                notes: sr.referredUnit ? `Referred unit: ${sr.referredUnit}` : null,
              },
            });
          } else {
            await prisma.productBatch.create({
              data: {
                productId,
                batchNo: sr.batch || null,
                receivedDate: STATEMENT_DATE,
                quantity: qty,
                remaining: qty,
                referenceType: 'StockStatement',
                referenceId: STATEMENT_REF,
                sourceQcInspectionId: qcId,
                notes: sr.referredUnit ? `Referred unit: ${sr.referredUnit}` : null,
              },
            });
          }
        }
        stats.batchesCreated++;
      }

      // REFERRED UNIT → ProductUnitStock
      if (sr.referredUnit) {
        const u = unitByKey.get(normUnitRef(sr.referredUnit));
        if (u && qty > 0 && COMMIT) {
          await prisma.productUnitStock.upsert({
            where: { productId_unitId: { productId, unitId: u.id } },
            update: { quantity: qty },
            create: { productId, unitId: u.id, quantity: qty },
          });
          stats.unitAllocations++;
        }
      }
    } catch (err) {
      stats.errors++;
      errors.push({ name: sr.name, code: finalCode, msg: err.message });
    }
  }

  console.log('\n=== PLAN SUMMARY ===');
  console.log(`Groups matched to MD codes:  ${groups.size}`);
  console.log(`Multi-variant suffixed:      ${[...groups.values()].filter(g => g.length > 1).length} groups`);
  console.log(`Novel (no MD match):         ${novel.length}`);
  console.log(`Total plan items:            ${plan.length}`);
  console.log('\n=== EXECUTION STATS ===');
  console.log(JSON.stringify(stats, null, 2));

  if (errors.length) {
    console.log('\nErrors (first 10):');
    for (const e of errors.slice(0, 10)) console.log(`  [${e.code}] ${e.name} — ${e.msg}`);
  }

  // Print a sample assignment table for sanity-check.
  console.log('\n=== SAMPLE ASSIGNMENTS (multi-variant groups) ===');
  for (const [base, rows] of groups.entries()) {
    if (rows.length <= 1) continue;
    console.log(`\n  MD ${base} — ${rows[0].mdMatch.mdRow.name}`);
    for (let i = 0; i < rows.length; i++) {
      const suffix = String.fromCharCode(65 + i);
      console.log(`    ${base}${suffix}: ${rows[i].name} (qty=${rows[i].qty}, ${rows[i].uom}, ref=${rows[i].referredUnit || '-'})`);
    }
  }
  console.log('\n=== NOVEL PRODUCTS (first 30) ===');
  for (const sr of novel.slice(0, 30)) console.log(`  [${sr.section}] ${sr.name}`);
  if (novel.length > 30) console.log(`  ... and ${novel.length - 30} more`);
}

run()
  .catch((e) => { console.error('Import failed:', e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
