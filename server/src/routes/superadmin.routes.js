// Hidden owner-only endpoints. All routes are 404 for anyone except SUPERADMIN.
const express = require('express');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const { authenticate } = require('../middleware/auth');
const { superadminOnly } = require('../middleware/superadminOnly');
const prisma = require('../config/db');
const { listBackupTree, signBackupUrl, previewBackup } = require('../services/s3Browse');

const execAsync = promisify(exec);

const router = express.Router();

// Apply guards to every route here. Note: errors mimic 404 so the existence of
// these endpoints isn't leaked to regular admins probing the API.
router.use(authenticate, superadminOnly);

// ────────────────────────────────────────────────────────────
//  Real-time Corrections — raw table editor
// ────────────────────────────────────────────────────────────

// Whitelisted Prisma model names. We never let the URL drive which model is touched
// without a check — typing /api/superadmin/table/foo would otherwise crash with
// `prisma.foo` undefined and could expose internal errors. The list mirrors the
// schema's models; expand if new ones are added.
const TABLES = [
  'User', 'Unit', 'Session', 'AuditLog', 'Product', 'ProductBatch', 'ProductUnitStock',
  'ProductRequest', 'RequestItem', 'StockMovement', 'PurchaseRequest', 'PurchaseRequestItem',
  'Quotation', 'QuotationItem', 'QuotationSource', 'PurchaseOrder', 'PurchaseOrderItem',
  'PurchaseOrderSource', 'PurchaseOrderItemAllocation', 'PaymentRequest', 'QCInspection',
  'QCInspectionItem', 'GatePass', 'GatePassItem', 'InterOfficeNote', 'InventoryTransferRequest',
  'InventoryTransferItem', 'Supplier', 'Tender', 'Notification',
];

// Convert PascalCase table name to camelCase Prisma model accessor.
const modelKey = (table) => table.charAt(0).toLowerCase() + table.slice(1);

// GET /api/superadmin/tables — table names with row counts
router.get('/tables', async (req, res) => {
  try {
    const out = [];
    for (const t of TABLES) {
      const key = modelKey(t);
      try {
        const count = await prisma[key].count();
        out.push({ name: t, rows: count });
      } catch {
        out.push({ name: t, rows: null });
      }
    }
    res.json({ tables: out });
  } catch (e) {
    console.error('superadmin/tables error:', e);
    res.status(500).json({ error: 'Failed to list tables' });
  }
});

// GET /api/superadmin/table/:name?page=1&limit=50
router.get('/table/:name', async (req, res) => {
  const { name } = req.params;
  if (!TABLES.includes(name)) return res.status(404).json({ error: 'Unknown table' });
  const key = modelKey(name);
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
  try {
    const [rows, total] = await Promise.all([
      prisma[key].findMany({ skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' } }),
      prisma[key].count(),
    ]);
    res.json({ rows, total, page, totalPages: Math.ceil(total / limit) });
  } catch (e) {
    // Tables without createdAt fall back to no ordering
    try {
      const [rows, total] = await Promise.all([
        prisma[key].findMany({ skip: (page - 1) * limit, take: limit }),
        prisma[key].count(),
      ]);
      res.json({ rows, total, page, totalPages: Math.ceil(total / limit) });
    } catch (e2) {
      console.error(`superadmin/table/${name} error:`, e2);
      res.status(500).json({ error: 'Failed to read table' });
    }
  }
});

// PUT /api/superadmin/table/:name/row/:id — partial update
router.put('/table/:name/row/:id', async (req, res) => {
  const { name, id } = req.params;
  if (!TABLES.includes(name)) return res.status(404).json({ error: 'Unknown table' });
  const key = modelKey(name);
  try {
    const updated = await prisma[key].update({ where: { id }, data: req.body });
    res.json(updated);
  } catch (e) {
    console.error(`superadmin update ${name}/${id} error:`, e);
    res.status(400).json({ error: e.message });
  }
});

// POST /api/superadmin/table/:name/row — insert
router.post('/table/:name/row', async (req, res) => {
  const { name } = req.params;
  if (!TABLES.includes(name)) return res.status(404).json({ error: 'Unknown table' });
  const key = modelKey(name);
  try {
    const created = await prisma[key].create({ data: req.body });
    res.status(201).json(created);
  } catch (e) {
    console.error(`superadmin create ${name} error:`, e);
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/superadmin/table/:name/row/:id
router.delete('/table/:name/row/:id', async (req, res) => {
  const { name, id } = req.params;
  if (!TABLES.includes(name)) return res.status(404).json({ error: 'Unknown table' });
  const key = modelKey(name);
  try {
    await prisma[key].delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) {
    console.error(`superadmin delete ${name}/${id} error:`, e);
    res.status(400).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────
//  Backups browser
// ────────────────────────────────────────────────────────────

// GET /api/superadmin/backups — tree of FY → tier → files
router.get('/backups', async (req, res) => {
  try {
    const tree = await listBackupTree();
    res.json({ tree });
  } catch (e) {
    console.error('superadmin/backups error:', e);
    res.status(500).json({ error: e.message || 'Failed to list backups' });
  }
});

// GET /api/superadmin/backups/preview?key=...
router.get('/backups/preview', async (req, res) => {
  if (!req.query.key) return res.status(400).json({ error: 'key required' });
  try {
    const preview = await previewBackup(req.query.key);
    res.json(preview);
  } catch (e) {
    console.error('superadmin/backups/preview error:', e);
    res.status(500).json({ error: e.message || 'Failed to preview' });
  }
});

// ────────────────────────────────────────────────────────────
//  System health — full snapshot for the System Health page
// ────────────────────────────────────────────────────────────

// GET /api/superadmin/health
router.get('/health', async (req, res) => {
  const out = { server: {}, app: {}, db: {}, activity: {}, backups: {} };

  // ── Server: load, memory, swap, uptime ────
  try {
    const { stdout } = await execAsync('cat /proc/loadavg');
    const parts = stdout.trim().split(/\s+/);
    out.server.loadavg = { '1m': Number(parts[0]), '5m': Number(parts[1]), '15m': Number(parts[2]) };
  } catch (_) { /* ignore */ }

  try {
    const { stdout: mi } = await execAsync('cat /proc/meminfo');
    const kB = (k) => {
      const m = mi.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm'));
      return m ? parseInt(m[1], 10) * 1024 : null;
    };
    const memTotal = kB('MemTotal');
    const memAvail = kB('MemAvailable');
    const swapTotal = kB('SwapTotal');
    const swapFree = kB('SwapFree');
    if (memTotal && memAvail != null) {
      out.server.memory = {
        total: memTotal,
        used: memTotal - memAvail,
        available: memAvail,
        percent: Math.round(((memTotal - memAvail) / memTotal) * 100),
      };
    }
    if (swapTotal) {
      out.server.swap = {
        total: swapTotal,
        used: swapTotal - swapFree,
        percent: Math.round(((swapTotal - swapFree) / swapTotal) * 100),
      };
    }
  } catch (_) { /* ignore */ }

  try {
    const { stdout } = await execAsync('cat /proc/uptime');
    out.server.uptimeSeconds = Math.floor(parseFloat(stdout.trim().split(' ')[0]));
  } catch (_) { /* ignore */ }

  // ── App: pm2 process list ────
  try {
    const { stdout } = await execAsync('pm2 jlist', { env: { ...process.env, PATH: `${process.env.PATH}:/usr/local/bin:/usr/bin` } });
    const procs = JSON.parse(stdout);
    out.app.processes = procs.map((p) => ({
      name: p.name,
      status: p.pm2_env?.status || null,
      uptimeMs: p.pm2_env?.pm_uptime ? Date.now() - p.pm2_env.pm_uptime : null,
      restarts: p.pm2_env?.restart_time ?? 0,
      cpu: p.monit?.cpu ?? null,
      memBytes: p.monit?.memory ?? null,
    }));
  } catch (_) { /* pm2 missing or not running */ }

  // ── Database ────
  try {
    const rows = await prisma.$queryRawUnsafe('SELECT pg_database_size(current_database())::bigint AS size');
    out.db.sizeBytes = Number(rows?.[0]?.size) || 0;
  } catch (_) { /* ignore */ }

  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE state = 'active')::int AS active,
              count(*) FILTER (WHERE state = 'idle')::int AS idle
       FROM pg_stat_activity WHERE datname = current_database()`
    );
    out.db.connections = rows[0] || null;
  } catch (_) { /* ignore */ }

  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT relname AS name,
              n_live_tup::bigint AS rows,
              pg_total_relation_size(relid)::bigint AS bytes
       FROM pg_stat_user_tables
       ORDER BY pg_total_relation_size(relid) DESC
       LIMIT 5`
    );
    out.db.topTables = rows.map((r) => ({
      name: r.name,
      rows: Number(r.rows),
      bytes: Number(r.bytes),
    }));
  } catch (_) { /* ignore */ }

  // ── Activity (last 24h) ────
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [logins24h, activeSessions, totalUsers] = await Promise.all([
      prisma.auditLog.count({ where: { action: 'LOGIN', createdAt: { gte: since } } }),
      prisma.session.count(),
      prisma.user.count({ where: { isActive: true } }),
    ]);
    out.activity = { logins24h, activeSessions, totalUsers };
  } catch (_) { /* ignore */ }

  try {
    const { stdout } = await execAsync('tail -n 30 /var/log/pm2/raps-error.log 2>/dev/null || true');
    out.activity.recentErrors = stdout
      .trim()
      .split('\n')
      .filter((l) => l && !/^\s*$/.test(l))
      .slice(-15);
  } catch (_) { /* ignore */ }

  // ── Backups ────
  try {
    const { stdout } = await execAsync('tail -n 200 /var/log/raps-backup.log 2>/dev/null || true');
    const lines = stdout.trim().split('\n').filter(Boolean);
    const lastComplete = [...lines].reverse().find((l) => /Backup complete/.test(l));
    const lastError = [...lines].reverse().find((l) => /\bERROR\b|pg_dump: error|copy failed/i.test(l));
    out.backups.lastSuccessAt = lastComplete?.match(/^\S+/)?.[0] || null;
    out.backups.lastErrorLine = lastError || null;
  } catch (_) { /* ignore */ }

  try {
    const REGION = process.env.AWS_REGION || 'ap-south-1';
    const BUCKET = process.env.S3_BACKUP_BUCKET || process.env.S3_BUCKET || '';
    if (BUCKET) {
      const { stdout } = await execAsync(
        `aws s3 ls s3://${BUCKET}/ --recursive --summarize --region ${REGION} 2>/dev/null | tail -n 5`
      );
      const totalMatch = stdout.match(/Total Size:\s+(\d+)/);
      const objMatch = stdout.match(/Total Objects:\s+(\d+)/);
      out.backups.s3 = {
        bucket: BUCKET,
        totalBytes: totalMatch ? parseInt(totalMatch[1], 10) : null,
        totalObjects: objMatch ? parseInt(objMatch[1], 10) : null,
      };
    }
  } catch (_) { /* ignore */ }

  res.json(out);
});

// ────────────────────────────────────────────────────────────
//  System info — disk / db / uploads usage (used by Backups page)
// ────────────────────────────────────────────────────────────

// GET /api/superadmin/system-info
router.get('/system-info', async (req, res) => {
  const out = { disk: null, dbBytes: null, uploadsBytes: null };

  // Root filesystem usage in bytes (skip on non-POSIX dev boxes — Windows has no df)
  try {
    const { stdout } = await execAsync("df -B1 / | awk 'NR==2 {print $2, $3, $4}'");
    const [total, used, available] = stdout.trim().split(/\s+/).map(Number);
    if (total) out.disk = { total, used, available, percent: Math.round((used / total) * 100) };
  } catch (_) { /* dev box, ignore */ }

  // Postgres DB size for the connected database
  try {
    const rows = await prisma.$queryRawUnsafe('SELECT pg_database_size(current_database())::bigint AS size');
    out.dbBytes = Number(rows?.[0]?.size) || 0;
  } catch (_) { /* ignore */ }

  // Uploads dir size
  try {
    const uploadsPath = path.resolve(__dirname, '../../uploads');
    const { stdout } = await execAsync(`du -sb "${uploadsPath}" 2>/dev/null | cut -f1`);
    out.uploadsBytes = parseInt(stdout.trim(), 10) || 0;
  } catch (_) { /* ignore */ }

  res.json(out);
});

// GET /api/superadmin/backups/signed-url?key=...
router.get('/backups/signed-url', async (req, res) => {
  if (!req.query.key) return res.status(400).json({ error: 'key required' });
  try {
    const url = await signBackupUrl(req.query.key);
    res.json({ url, expiresIn: 300 });
  } catch (e) {
    console.error('superadmin/backups/signed-url error:', e);
    res.status(500).json({ error: e.message || 'Failed to sign URL' });
  }
});

module.exports = router;
