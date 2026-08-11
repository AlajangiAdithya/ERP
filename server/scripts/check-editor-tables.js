#!/usr/bin/env node
// Health check for the row editors (SUPERADMIN "Tables" / DATA_EDITOR "Edit Data").
//
// Walks EVERY entry the editor publishes — the curated views plus all 84 models
// — through the exact same code path the HTTP route uses, and reports for each:
//
//   OK    <n> rows          read fine, has data
//   EMPTY 0 rows            read fine, table is genuinely empty
//   FAIL  <reason>          the read errored — this is what shows up as a broken
//                           or blank table in the UI
//
// Answers two questions directly: "is anything erroring?" and "which tables are
// empty because they have no data, rather than because something is broken?"
//
// Usage (from server/):   node scripts/check-editor-tables.js
//        only failures:   node scripts/check-editor-tables.js --fails
//
// Exits 1 if any table failed to read, so it can gate a deploy.
require('dotenv').config();
const { Prisma, PrismaClient } = require('@prisma/client');
const { resolveTable, listTables } = require('../src/utils/virtualTables');
const { readTablePage, prismaErrorMessage } = require('../src/utils/tableRead');

const onlyFails = process.argv.includes('--fails');
const prisma = new PrismaClient();
const TABLES = Prisma.dmmf.datamodel.models.map((m) => m.name);

const pad = (s, n) => String(s).padEnd(n);

(async () => {
  const started = Date.now();

  // Same listing the UI loads, so a slow/failing table list shows up here too.
  const listStart = Date.now();
  const catalogue = await listTables(TABLES, async (key, where) => {
    try {
      return await prisma[key].count(where ? { where } : undefined);
    } catch {
      return null;
    }
  });
  const listMs = Date.now() - listStart;

  const results = [];
  for (const entry of catalogue) {
    const t = resolveTable(entry.name, TABLES);
    const row = { name: entry.name, label: entry.label, group: entry.group, count: entry.rows };
    try {
      const page = await readTablePage(prisma, t, { page: 1, limit: 5 });
      row.status = page.total === 0 ? 'EMPTY' : 'OK';
      row.total = page.total;
      row.sampled = page.rows.length;
      row.labelsResolved = page.labelsResolved;
    } catch (e) {
      row.status = 'FAIL';
      row.error = prismaErrorMessage(e);
    }
    results.push(row);
  }

  let group = null;
  for (const r of results) {
    if (onlyFails && r.status !== 'FAIL') continue;
    if (r.group !== group) {
      group = r.group;
      console.log(`\n── ${group} ──`);
    }
    if (r.status === 'FAIL') {
      console.log(`  FAIL  ${pad(r.label, 38)} ${r.error}`);
    } else {
      const degraded = r.labelsResolved === false ? '  (foreign-key names not resolved)' : '';
      console.log(`  ${pad(r.status, 5)} ${pad(r.label, 38)} ${r.total} rows${degraded}`);
    }
  }

  const fails = results.filter((r) => r.status === 'FAIL');
  const empty = results.filter((r) => r.status === 'EMPTY');
  const withData = results.filter((r) => r.status === 'OK');
  const degraded = results.filter((r) => r.labelsResolved === false);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`tables checked : ${results.length}   (list built in ${listMs}ms)`);
  console.log(`with data      : ${withData.length}`);
  console.log(`empty          : ${empty.length}`);
  console.log(`failed to read : ${fails.length}`);
  if (degraded.length) console.log(`degraded labels: ${degraded.length} (rows load, FK names don't resolve)`);
  if (empty.length && !onlyFails) {
    console.log(`\nempty tables: ${empty.map((r) => r.label).join(', ')}`);
  }
  if (fails.length) {
    console.log(`\nFAILURES:`);
    fails.forEach((r) => console.log(`  ${r.label} (${r.name}): ${r.error}`));
  }
  console.log(`\ndone in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  await prisma.$disconnect();
  process.exit(fails.length ? 1 : 0);
})().catch(async (e) => {
  console.error('check failed to run:', e.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
