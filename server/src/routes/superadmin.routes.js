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
//  System info — disk / db / uploads usage
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
