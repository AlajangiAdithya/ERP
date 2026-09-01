// One-off: move every product onto the material-code register's categories
// (src/utils/materialCategories.js). The register replaced the old ad-hoc list,
// so rows still carrying a renamed label are moved:
//
//   Machinery            → Plant & Machinery
//   Fasteners / Fastners → Brought Items
//   Stationary           → Stationery      (spelling)
//   …and every other alias normalizeMaterialType() knows about.
//
// Genuinely retired labels are LEFT ALONE on purpose — 'Raw Material',
// 'Raw Materials - Composites', 'Hand Tools' and 'Hand Tools & Fastners' each
// span more than one of the new blocks (or no longer have one), so re-bucketing
// them would be a guess. Those are re-picked by hand on the Master Data screen;
// the dropdown keeps showing the stored label until someone does.
//
// Material codes are NOT touched: an existing code stays with its material even
// when its category's block says otherwise. Only new materials draw from the
// register (see nextMaterialCode / the Add Product form).
//
//   node scripts/migrate-material-categories.js          # DRY RUN — prints the plan, writes nothing
//   node scripts/migrate-material-categories.js --apply  # writes the changes
//
// Safe to re-run: a second pass finds nothing left to change.

const prisma = require('../src/config/db');
const {
  normalizeMaterialType, LEGACY_MATERIAL_TYPES, codeMatchesCategory, formatCodeRange,
} = require('../src/utils/materialCategories');

async function main() {
  const apply = process.argv.includes('--apply');

  const products = await prisma.product.findMany({
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, sku: true, materialCode: true, category: true },
  });

  if (!products.length) {
    console.log('No products found — nothing to migrate.');
    return;
  }

  const changes = [];
  const kept = new Map();   // retired label → count left as-is
  const offBlock = [];      // codes that sit outside their category's block

  for (const p of products) {
    const current = p.category || '';
    const next = normalizeMaterialType(current);
    if (next !== current) {
      if (LEGACY_MATERIAL_TYPES.includes(next)) {
        kept.set(next, (kept.get(next) || 0) + 1);
      } else {
        changes.push({ ...p, next });
      }
    } else if (LEGACY_MATERIAL_TYPES.includes(current)) {
      kept.set(current, (kept.get(current) || 0) + 1);
    }
    const code = p.materialCode || p.sku;
    if (code && !codeMatchesCategory(code, next)) offBlock.push({ ...p, next, code });
  }

  console.log(`\n${products.length} products scanned.\n`);

  if (!changes.length) {
    console.log('No category needs renaming.');
  } else {
    console.log(`${changes.length} to re-label:\n`);
    console.log(`  ${'from'.padEnd(26)}${'to'.padEnd(30)}name`);
    console.log(`  ${'-'.repeat(26)}${'-'.repeat(30)}----`);
    for (const c of changes) {
      console.log(`  ${(c.category || '—').padEnd(26)}${c.next.padEnd(30)}${c.name}`);
    }
  }

  if (kept.size) {
    console.log('\nLeft as-is (retired labels — re-pick these by hand on the Master Data screen):');
    for (const [label, n] of kept) console.log(`  ${String(n).padStart(4)}  ${label}`);
  }

  if (offBlock.length) {
    console.log(`\n${offBlock.length} material code(s) sit outside their category's block — not changed, listed for review:`);
    for (const o of offBlock.slice(0, 50)) {
      console.log(`  ${String(o.code).padEnd(10)}${o.next.padEnd(30)}(block ${formatCodeRange(o.next)})  ${o.name}`);
    }
    if (offBlock.length > 50) console.log(`  … and ${offBlock.length - 50} more`);
  }

  if (!apply) {
    console.log('\nDRY RUN — nothing was written. Re-run with --apply to save.\n');
    return;
  }
  if (!changes.length) {
    console.log('\nNothing to write.\n');
    return;
  }

  for (const c of changes) {
    await prisma.product.update({ where: { id: c.id }, data: { category: c.next } });
  }
  console.log(`\n${changes.length} products re-labelled.\n`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
