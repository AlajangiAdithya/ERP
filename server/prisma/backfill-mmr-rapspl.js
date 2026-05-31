// Backfill: assign sequential RAPSPL serial numbers to every existing MMR
// calibration item, scoped per sub-category bucket. Each bucket gets its
// own running 001, 002, ... counter, ordered by createdAt.
//
//   node prisma/backfill-mmr-rapspl.js          # apply
//   node prisma/backfill-mmr-rapspl.js --dry    # preview only
//
// Idempotent: re-running produces the same numbers because ordering is by
// createdAt (and id as tiebreaker).

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const MMR_SUB_PREFIX = {
  PRESSURE_GAUGES:              'PG',
  VACUUM_GAUGES:                'VG',
  METROLOGY_INSTRUMENTS:        'MI',
  LAB_TESTING_EQUIPMENT:        'LTE',
  AUTOCLAVE_OVEN_THERMOCOUPLES: 'AOT',
  EOT_CRANES_CHAIN_BLOCKS:      'EOT',
  OTHER:                        'OTH',
};

const SUB_LABEL = {
  PRESSURE_GAUGES:              'Pressure gauges',
  VACUUM_GAUGES:                'Vacuum gauges',
  METROLOGY_INSTRUMENTS:        'Metrology instruments',
  LAB_TESTING_EQUIPMENT:        'Mechanical & chemical lab testing equipment',
  AUTOCLAVE_OVEN_THERMOCOUPLES: 'Autoclave, Oven, Thermocouples',
  EOT_CRANES_CHAIN_BLOCKS:      'EOT cranes, Chain block pulleys',
  OTHER:                        'Other equipment',
};

async function main() {
  const dryRun = process.argv.includes('--dry');
  if (dryRun) console.log('DRY RUN — no writes will happen.\n');

  const rows = await prisma.calibrationItem.findMany({
    where: { category: 'MMR' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      name: true,
      mmrSubCategory: true,
      rapsplSerialNo: true,
      createdAt: true,
    },
  });

  console.log(`Found ${rows.length} MMR calibration item${rows.length === 1 ? '' : 's'}.\n`);
  if (rows.length === 0) return;

  // Walk rows in chronological order and mint a fresh serial per bucket.
  // Items missing a sub-category land in the OTHER bucket.
  const counters = {};
  const updates = [];

  for (const row of rows) {
    const sub = row.mmrSubCategory || 'OTHER';
    counters[sub] = (counters[sub] || 0) + 1;
    const prefix = `RAPSPL/${MMR_SUB_PREFIX[sub] || 'OTH'}/`;
    const newSerial = `${prefix}${String(counters[sub]).padStart(3, '0')}`;
    if (row.rapsplSerialNo !== newSerial) {
      updates.push({ id: row.id, name: row.name, sub, from: row.rapsplSerialNo, to: newSerial });
    }
  }

  // Report per-bucket totals.
  console.log('Per-bucket counts:');
  for (const sub of Object.keys(counters).sort()) {
    console.log(`  ${SUB_LABEL[sub] || sub} (${MMR_SUB_PREFIX[sub] || 'OTH'}): ${counters[sub]}`);
  }
  console.log();

  if (updates.length === 0) {
    console.log('All RAPSPL serials already match the expected sequence. Nothing to update.');
    return;
  }

  console.log(`${updates.length} row${updates.length === 1 ? '' : 's'} need${updates.length === 1 ? 's' : ''} a new serial:`);
  for (const u of updates) {
    const prev = u.from ? `"${u.from}"` : '(empty)';
    console.log(`  ${u.to}  <-  ${prev}   ${u.name}`);
  }
  console.log();

  if (dryRun) {
    console.log('Dry run complete. Re-run without --dry to apply.');
    return;
  }

  // Apply in a single transaction so the table is consistent even on failure.
  console.log('Applying updates...');
  await prisma.$transaction(
    updates.map((u) =>
      prisma.calibrationItem.update({
        where: { id: u.id },
        data: { rapsplSerialNo: u.to },
      })
    )
  );
  console.log(`Done. Updated ${updates.length} row${updates.length === 1 ? '' : 's'}.`);
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
