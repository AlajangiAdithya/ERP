// One-off: rewrite every Product's identification number into a single running
// serial — 001, 002, 003 … assigned oldest-product-first. The number is written
// to `sku` (the system identification field) and `materialCode` is cleared to
// null, so the displayed "ID No." (materialCode || sku) shows the running series
// uniformly for these and for future auto-created products. The old category
// prefixes (CONS-/RAW-/TOOL-…) and any legacy customer codes are discarded —
// this was explicitly requested.
//
//   node scripts/renumber-product-ids.js            # DRY RUN — prints the mapping, writes nothing
//   node scripts/renumber-product-ids.js --apply    # writes the changes
//
// Safe to re-run: with no new products it reproduces the same numbering.

const prisma = require('../src/config/db');

const PAD = 3;

async function main() {
  const apply = process.argv.includes('--apply');

  // Oldest product first → it gets 001. id as a stable tiebreaker.
  const products = await prisma.product.findMany({
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, sku: true, materialCode: true },
  });

  if (!products.length) {
    console.log('No products found — nothing to renumber.');
    return;
  }

  const plan = products.map((p, i) => ({ ...p, newId: String(i + 1).padStart(PAD, '0') }));

  console.log(`\n${plan.length} products → running series 001 … ${plan[plan.length - 1].newId}\n`);
  console.log(`  ${'old sku'.padEnd(14)}${'old code'.padEnd(14)}new   name`);
  console.log(`  ${'-'.repeat(14)}${'-'.repeat(14)}----  ----`);
  for (const p of plan) {
    console.log(`  ${(p.sku || '—').padEnd(14)}${(p.materialCode || '—').padEnd(14)}${p.newId}   ${p.name}`);
  }

  if (!apply) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to commit these changes.\n');
    return;
  }

  await prisma.$transaction(async (tx) => {
    // Pass 1: park every code on a guaranteed-unique temporary sku (and clear
    // materialCode) so the final values can't transiently collide with a row
    // that hasn't been processed yet — both sku and materialCode are @unique.
    for (const p of plan) {
      await tx.product.update({ where: { id: p.id }, data: { sku: `TMP-${p.id}`, materialCode: null } });
    }
    // Pass 2: assign the final running numbers.
    for (const p of plan) {
      await tx.product.update({ where: { id: p.id }, data: { sku: p.newId } });
    }
  }, { timeout: 120000 });

  console.log(`\n✓ Renumbered ${plan.length} products into 001 … ${plan[plan.length - 1].newId}.\n`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
