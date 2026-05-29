// One-shot importer for the "Material Details" register
// (C:/Users/alaja/Downloads/Material Details.xlsx → material-details.json).
//
// Upserts every row into Product, keyed on `materialCode` (the Excel identification number).
// - Existing products with that materialCode are updated (name/category/unit/minStock).
// - New products get a fresh auto-generated SKU (RAW/CONS/TOOL/OTH-NNNN).
//
// Run from the server folder:
//   node scripts/import-material-details.js
//
// Re-runnable: a second run won't create duplicates.

const path = require('path');
const fs = require('fs');
const prisma = require('../src/config/db');
const {
  generateProductSku,
  normalizeMaterialType,
  isUniqueViolation,
} = require('../src/utils/helpers');

const DATA_PATH = path.join(__dirname, 'material-details.json');

// Map the Excel "Type of material" column to one of the four canonical
// MATERIAL_TYPES recognised by the rest of the app. "Capital" rows are
// almost all fixtures / tooling, "Stationery" falls into Others.
function mapType(excelType) {
  const t = (excelType || '').trim().toLowerCase();
  if (t === 'raw material') return 'Raw Material';
  if (t === 'consumable' || t === 'consumables') return 'Consumable';
  if (t === 'capital') return 'Tooling';
  if (t === 'stationery') return 'Others';
  return normalizeMaterialType(excelType);
}

// Normalise the UOM column. Excel uses "M", "Kg", "No's", "Box"…; the app's
// dropdown is lowercase pcs/kg/litre/meter/box/set. Anything we don't
// recognise is passed through verbatim.
function mapUnit(excelUnit) {
  const u = (excelUnit || '').trim().toLowerCase().replace(/['.]/g, '');
  if (u === 'm' || u === 'meter' || u === 'metre' || u === 'mtr') return 'meter';
  if (u === 'kg' || u === 'kgs') return 'kg';
  if (u === 'l' || u === 'litre' || u === 'ltr') return 'litre';
  if (u === 'box' || u === 'boxes') return 'box';
  if (u === 'set' || u === 'sets') return 'set';
  if (u === 'no' || u === 'nos' || u === 'pcs' || u === 'pc' || u === 'piece' || u === 'pieces') return 'pcs';
  if (u === 'sq mtr' || u === 'sqm' || u === 'sq m') return 'Sq. mtr';
  return excelUnit || 'pcs';
}

async function run() {
  const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  console.log(`Loaded ${raw.length} rows from ${path.basename(DATA_PATH)}`);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];

  for (const row of raw) {
    const materialCode = String(row.materialCode || '').trim();
    if (!materialCode || !row.name) {
      skipped++;
      continue;
    }

    const category = mapType(row.type);
    const unit = mapUnit(row.unit);
    const minStockLevel = typeof row.minStock === 'number' && row.minStock > 0 ? row.minStock : 0;
    const descriptionParts = [row.usage, row.remarks].filter(Boolean);
    const description = descriptionParts.length ? descriptionParts.join(' | ') : undefined;

    try {
      const existing = await prisma.product.findUnique({ where: { materialCode } });
      if (existing) {
        await prisma.product.update({
          where: { id: existing.id },
          data: {
            name: row.name,
            category,
            unit,
            minStockLevel,
            description: description ?? existing.description,
          },
        });
        updated++;
      } else {
        // Retry on rare SKU collisions (concurrent runs only — single-thread is safe).
        let sku = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            sku = await generateProductSku(prisma, category);
            await prisma.product.create({
              data: {
                materialCode,
                name: row.name,
                sku,
                category,
                unit,
                minStockLevel,
                description,
              },
            });
            break;
          } catch (err) {
            if (!isUniqueViolation(err) || attempt === 4) throw err;
          }
        }
        created++;
      }
    } catch (err) {
      errors.push({ materialCode, name: row.name, message: err.message });
    }
  }

  console.log(`\nDone. Created: ${created}  Updated: ${updated}  Skipped: ${skipped}  Errors: ${errors.length}`);
  if (errors.length) {
    console.log('\nFirst 10 errors:');
    for (const e of errors.slice(0, 10)) console.log(`  [${e.materialCode}] ${e.name} — ${e.message}`);
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
