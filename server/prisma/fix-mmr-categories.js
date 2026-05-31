// One-shot fix: classify every existing MMR calibration item into its
// correct sub-category by inspecting the item name, then renumber
// rapsplSerialNo with a fresh sequence per bucket.
//
//   node prisma/fix-mmr-categories.js --dry      # preview only
//   node prisma/fix-mmr-categories.js            # apply
//
// Re-running is safe: the classifier is deterministic and the renumber
// step is ordered by createdAt + id.

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

// Keyword-based classifier. Order matters — earlier rules win. Tuned to the
// equipment vocabulary used in the RAPS register.
const RULES = [
  { sub: 'AUTOCLAVE_OVEN_THERMOCOUPLES',
    keywords: ['autoclave', 'oven', 'thermocouple', 'temperature scanner', 'temp scanner',
               'pid controller', 'safety controller', 'furnace', 'kiln'] },
  { sub: 'EOT_CRANES_CHAIN_BLOCKS',
    keywords: ['eot', 'crane', 'chain block', 'chain-block', 'chain pulley', 'pulley block',
               'hoist'] },
  { sub: 'VACUUM_GAUGES',
    keywords: ['vacuum gauge', 'vacuum-gauge', 'vacuum meter', 'vac gauge'] },
  { sub: 'PRESSURE_GAUGES',
    keywords: ['pressure gauge', 'pressure-gauge', 'pressure meter', 'manometer',
               'pressure transmitter', 'pressure sensor'] },
  { sub: 'METROLOGY_INSTRUMENTS',
    keywords: ['vernier', 'caliper', 'micrometer', 'height gauge', 'bore gauge',
               'plug gauge', 'ring gauge', 'snap gauge', 'thread gauge', 'feeler gauge',
               'dial gauge', 'dial indicator', 'slip gauge', 'protractor', 'gauge block',
               'surface plate', 'square', 'scale', 'tape measure'] },
  { sub: 'LAB_TESTING_EQUIPMENT',
    keywords: ['tensile', 'utm', 'universal testing', 'hardness', 'rockwell', 'brinell',
               'vickers', 'impact tester', 'charpy', 'izod', 'spectrometer', 'spectroscop',
               'ph meter', 'conductivity meter', 'viscometer', 'viscosity', 'density meter',
               'moisture analyzer', 'titrator', 'centrifuge', 'microscope', 'balance',
               'weighing'] },
];

const classify = (name) => {
  const n = (name || '').toLowerCase();
  if (!n) return 'OTHER';
  for (const rule of RULES) {
    if (rule.keywords.some((k) => n.includes(k))) return rule.sub;
  }
  return 'OTHER';
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

  // Pass 1 — classify each row.
  const classified = rows.map((row) => ({ ...row, newSub: classify(row.name) }));

  // Pass 2 — walk in chronological order and assign per-bucket serials.
  const counters = {};
  const updates = [];

  for (const row of classified) {
    counters[row.newSub] = (counters[row.newSub] || 0) + 1;
    const prefix = `RAPSPL/${MMR_SUB_PREFIX[row.newSub]}/`;
    const newSerial = `${prefix}${String(counters[row.newSub]).padStart(3, '0')}`;
    const subChanged = row.mmrSubCategory !== row.newSub;
    const serialChanged = row.rapsplSerialNo !== newSerial;
    if (subChanged || serialChanged) {
      updates.push({
        id: row.id,
        name: row.name,
        oldSub: row.mmrSubCategory,
        newSub: row.newSub,
        oldSerial: row.rapsplSerialNo,
        newSerial,
        subChanged,
        serialChanged,
      });
    }
  }

  console.log('Per-bucket counts after fix:');
  for (const sub of Object.keys(counters).sort()) {
    console.log(`  ${SUB_LABEL[sub]} (${MMR_SUB_PREFIX[sub]}): ${counters[sub]}`);
  }
  console.log();

  if (updates.length === 0) {
    console.log('Every row is already in the correct bucket with the right serial. Nothing to do.');
    return;
  }

  console.log(`${updates.length} row${updates.length === 1 ? '' : 's'} will change:`);
  for (const u of updates) {
    const prev = u.oldSerial ? `"${u.oldSerial}"` : '(empty)';
    const bucket = u.subChanged ? ` [${u.oldSub || 'unset'} → ${u.newSub}]` : '';
    console.log(`  ${u.newSerial}  <-  ${prev}${bucket}   ${u.name}`);
  }
  console.log();

  if (dryRun) {
    console.log('Dry run complete. Re-run without --dry to apply.');
    return;
  }

  console.log('Applying updates...');
  await prisma.$transaction(
    updates.map((u) =>
      prisma.calibrationItem.update({
        where: { id: u.id },
        data: { mmrSubCategory: u.newSub, rapsplSerialNo: u.newSerial },
      })
    )
  );
  console.log(`Done. Updated ${updates.length} row${updates.length === 1 ? '' : 's'}.`);
}

main()
  .catch((err) => {
    console.error('Fix failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
