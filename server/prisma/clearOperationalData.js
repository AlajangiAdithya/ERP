/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────────
// clearOperationalData.js — wipe all OPERATIONAL / TRANSACTIONAL data, keeping
// logins + master/reference data so the system is a clean slate but still usable.
//
//   KEPT  : Users, Sessions, PushSubscriptions, Units, the full Supplier master
//           (incl. SA/VE compliance + performance ratings), Employees, SkillMatrix,
//           Vehicles, Drivers, Machinery, Fire Extinguishers, Calibration items,
//           QMS certifications & documents.
//   WIPED : everything else — products + stock + batches, MIR (Material Inward),
//           MIV (ProductRequest), GatePass/FIM, PR, PO, quotations, QC inspections,
//           Work Orders (+ all sub-records), payments, ION, transfers, notifications,
//           messages, audit logs, calendar, attendance, training, calibration records.
//
// SAFETY
//   • Dry-run by default. It only deletes when you pass CONFIRM=WIPE.
//   • Takes a pg_dump backup first (skip with SKIP_BACKUP=1; force-without-backup
//     with FORCE_NO_BACKUP=1).
//   • The wipe runs inside a transaction that verifies no KEPT table lost rows;
//     if anything would cascade into kept data it ROLLS BACK and aborts.
//
// USAGE (run on the server, from the `server/` directory)
//   node prisma/clearOperationalData.js            # dry run — shows the plan
//   CONFIRM=WIPE node prisma/clearOperationalData.js
//   CONFIRM=WIPE SKIP_BACKUP=1 node prisma/clearOperationalData.js
// On Windows PowerShell:
//   $env:CONFIRM="WIPE"; node prisma/clearOperationalData.js
// ─────────────────────────────────────────────────────────────────────────────

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { PrismaClient, Prisma } = require('@prisma/client');
const prisma = new PrismaClient();

// Models to PRESERVE. Everything else in the schema gets truncated.
const KEEP = new Set([
  'User', 'Session', 'PushSubscription', 'Unit',
  'Supplier', 'SupplierVendorEvaluation', 'SupplierReEvaluation',
  'SupplierAssessmentForm', 'SupplierPerformanceRating', 'SupplierPerformanceRatingItem',
  'Employee', 'SkillMatrix',
  'Vehicle', 'Driver',
  'Machinery', 'FireExtinguisher',
  'CalibrationItem',
  'QmsCertification', 'QmsDocument',
]);

const modelKey = (name) => name.charAt(0).toLowerCase() + name.slice(1);
const allModels = Prisma.dmmf.datamodel.models.map((m) => m.name);
const wipeModels = allModels.filter((m) => !KEEP.has(m));
const keepModels = allModels.filter((m) => KEEP.has(m));

// Guard against typos in KEEP that wouldn't match any real model.
const unknownKeep = [...KEEP].filter((m) => !allModels.includes(m));
if (unknownKeep.length) {
  console.error(`✖ KEEP lists models that don't exist in the schema: ${unknownKeep.join(', ')}`);
  process.exit(1);
}

async function countAll(models) {
  const out = {};
  for (const m of models) {
    try { out[m] = await prisma[modelKey(m)].count(); } catch { out[m] = null; }
  }
  return out;
}

function backupDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const u = new URL(url);
  const host = u.hostname;
  const port = u.port || '5432';
  const user = decodeURIComponent(u.username);
  const db = u.pathname.replace(/^\//, '');

  const dir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `pre-wipe-${db}-${stamp}.sql`);

  console.log(`→ Backing up "${db}" with pg_dump …`);
  execSync(`pg_dump -h ${host} -p ${port} -U ${user} -d ${db} --no-owner --no-acl -f "${file}"`, {
    stdio: 'inherit',
    env: { ...process.env, PGPASSWORD: decodeURIComponent(u.password) },
  });
  console.log(`✓ Backup written: ${file}\n`);
  return file;
}

async function main() {
  const confirm = process.env.CONFIRM === 'WIPE';

  console.log('\n=== RAPS ERP — Clear operational data ===\n');
  console.log(`Database : ${(process.env.DATABASE_URL || '').replace(/:\/\/([^:]+):[^@]*@/, '://$1:****@')}`);
  console.log(`Mode     : ${confirm ? 'WIPE (live)' : 'DRY RUN (no changes)'}\n`);

  const before = await countAll(allModels);
  const sum = (models) => models.reduce((n, m) => n + (before[m] || 0), 0);

  console.log(`KEEP (${keepModels.length} tables, ${sum(keepModels)} rows preserved):`);
  console.log('  ' + keepModels.join(', ') + '\n');
  console.log(`WIPE (${wipeModels.length} tables, ${sum(wipeModels)} rows to delete):`);
  wipeModels.forEach((m) => { if (before[m]) console.log(`  ${m.padEnd(34)} ${before[m]}`); });
  const emptyWipe = wipeModels.filter((m) => !before[m]);
  if (emptyWipe.length) console.log(`  (already empty: ${emptyWipe.length} tables)`);
  console.log('');

  if (!confirm) {
    console.log('Dry run only. Re-run with  CONFIRM=WIPE  to perform the wipe.');
    return;
  }

  // ── Backup ──
  if (process.env.SKIP_BACKUP === '1') {
    console.log('⚠ SKIP_BACKUP=1 — skipping pg_dump.\n');
  } else {
    try {
      backupDatabase();
    } catch (e) {
      console.error(`✖ Backup failed: ${e.message}`);
      if (process.env.FORCE_NO_BACKUP === '1') {
        console.warn('⚠ FORCE_NO_BACKUP=1 — proceeding WITHOUT a backup.\n');
      } else {
        console.error('Aborting. Pass SKIP_BACKUP=1 (you have a backup) or FORCE_NO_BACKUP=1 to override.');
        process.exit(1);
      }
    }
  }

  // ── Wipe inside a transaction with a keep-table safety check ──
  const quoted = wipeModels.map((m) => `"${m}"`).join(', ');
  await prisma.$transaction(async (tx) => {
    const keepBefore = {};
    for (const m of keepModels) keepBefore[m] = await tx[modelKey(m)].count();

    await tx.$executeRawUnsafe(`TRUNCATE ${quoted} RESTART IDENTITY CASCADE`);

    for (const m of keepModels) {
      const after = await tx[modelKey(m)].count();
      if (after !== keepBefore[m]) {
        throw new Error(`Safety abort: kept table "${m}" lost rows (${keepBefore[m]} → ${after}). Rolling back — nothing was deleted.`);
      }
    }
  }, { timeout: 120000 });

  console.log('✓ Wipe complete.\n');
  const after = await countAll(wipeModels);
  const leftover = wipeModels.filter((m) => after[m]);
  if (leftover.length) {
    console.warn('⚠ Some wiped tables still report rows (unexpected):');
    leftover.forEach((m) => console.warn(`  ${m}: ${after[m]}`));
  } else {
    console.log('All targeted tables are now empty. Logins + master data preserved.');
  }
}

main()
  .catch((e) => { console.error('\n✖ Error:', e.message); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
