// Report Postgres storage by table — works against any Postgres backend.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const tableSizes = await prisma.$queryRawUnsafe(`
    SELECT
      relname AS table,
      pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
      pg_total_relation_size(c.oid) AS total_bytes,
      pg_size_pretty(pg_relation_size(c.oid)) AS data_size,
      pg_size_pretty(pg_indexes_size(c.oid)) AS index_size,
      reltuples::bigint AS estimated_rows
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND n.nspname = 'public'
    ORDER BY pg_total_relation_size(c.oid) DESC;
  `);

  const totalSize = await prisma.$queryRawUnsafe(`
    SELECT pg_size_pretty(pg_database_size(current_database())) AS total,
           pg_database_size(current_database()) AS bytes;
  `);

  console.log('=== Per-table sizes (top consumers) ===');
  console.log('Table'.padEnd(35) + 'Total'.padEnd(12) + 'Data'.padEnd(12) + 'Index'.padEnd(12) + 'Rows');
  console.log('─'.repeat(95));
  for (const t of tableSizes.slice(0, 30)) {
    console.log(
      String(t.table).padEnd(35) +
      String(t.total_size).padEnd(12) +
      String(t.data_size).padEnd(12) +
      String(t.index_size).padEnd(12) +
      String(t.estimated_rows)
    );
  }

  const sumBytes = tableSizes.reduce((s, t) => s + Number(t.total_bytes), 0);
  console.log('\n=== Database total ===');
  console.log(`Database size: ${totalSize[0].total} (${(Number(totalSize[0].bytes) / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`Sum of public.* tables: ${(sumBytes / 1024 / 1024).toFixed(2)} MB`);

  await prisma.$disconnect();
})();
