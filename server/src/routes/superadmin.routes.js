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
  'InventoryTransferItem', 'Supplier', 'WorkOrder', 'WorkOrderExtension', 'WorkOrderInvoice', 'Notification',
  'CalibrationItem', 'CalibrationRecord',
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
//  Uploads inventory — aggregated view of every file URL stored
//  across the schema. Lets SUPERADMIN audit and prune attachments
//  (PR specs, quotation/PO PDFs, supplier docs, QC invoices, …)
//  from one place. "Delete" nulls the DB field; the file blob on
//  disk is intentionally left alone.
// ────────────────────────────────────────────────────────────

// Schema of every file-bearing field. Drives both the aggregate listing and
// the delete handler (only fields listed here are deletable).
const FILE_FIELDS = {
  PurchaseRequest: [{ field: 'materialSpecsPdfUrl', label: 'Material Specs PDF' }],
  Supplier: [
    { field: 'vendorEvaluationPdfUrl', label: 'Vendor Evaluation PDF', uploadedAtField: 'vendorEvaluationUploadedAt' },
    { field: 'supplierAssessmentPdfUrl', label: 'Supplier Assessment PDF', uploadedAtField: 'assessmentUploadedAt' },
  ],
  Quotation: [{ field: 'quotationPdfUrl', label: 'Quotation PDF' }],
  PurchaseOrder: [{ field: 'poDocumentUrl', label: 'Signed PO PDF' }],
  QCInspection: [{ field: 'invoiceFileUrl', label: 'Lot Invoice PDF' }],
};

// GET /api/superadmin/uploads — every file URL across the schema, newest first.
router.get('/uploads', async (req, res) => {
  try {
    const uploads = [];

    // 1. PurchaseRequest.materialSpecsPdfUrl
    const prs = await prisma.purchaseRequest.findMany({
      where: { materialSpecsPdfUrl: { not: null } },
      select: {
        id: true, requestNumber: true, materialSpecsPdfUrl: true,
        createdAt: true, manager: { select: { name: true } },
      },
    });
    prs.forEach((p) => uploads.push({
      table: 'PurchaseRequest', recordId: p.id, field: 'materialSpecsPdfUrl',
      label: 'Material Specs PDF', recordLabel: p.requestNumber,
      url: p.materialSpecsPdfUrl, uploadedAt: p.createdAt,
      uploadedBy: p.manager?.name || null,
    }));

    // 2. Supplier docs
    const suppliers = await prisma.supplier.findMany({
      where: {
        OR: [
          { vendorEvaluationPdfUrl: { not: null } },
          { supplierAssessmentPdfUrl: { not: null } },
        ],
      },
      select: {
        id: true, name: true,
        vendorEvaluationPdfUrl: true, vendorEvaluationUploadedAt: true,
        supplierAssessmentPdfUrl: true, assessmentUploadedAt: true, assessmentFiscalYear: true,
      },
    });
    suppliers.forEach((s) => {
      if (s.vendorEvaluationPdfUrl) uploads.push({
        table: 'Supplier', recordId: s.id, field: 'vendorEvaluationPdfUrl',
        label: 'Vendor Evaluation PDF', recordLabel: s.name,
        url: s.vendorEvaluationPdfUrl, uploadedAt: s.vendorEvaluationUploadedAt, uploadedBy: null,
      });
      if (s.supplierAssessmentPdfUrl) uploads.push({
        table: 'Supplier', recordId: s.id, field: 'supplierAssessmentPdfUrl',
        label: `Supplier Assessment PDF${s.assessmentFiscalYear ? ` (FY ${s.assessmentFiscalYear})` : ''}`,
        recordLabel: s.name,
        url: s.supplierAssessmentPdfUrl, uploadedAt: s.assessmentUploadedAt, uploadedBy: null,
      });
    });

    // 3. Quotation.quotationPdfUrl
    const quots = await prisma.quotation.findMany({
      where: { quotationPdfUrl: { not: null } },
      select: {
        id: true, quotationNumber: true, quotationPdfUrl: true,
        createdAt: true, createdBy: { select: { name: true } },
      },
    });
    quots.forEach((q) => uploads.push({
      table: 'Quotation', recordId: q.id, field: 'quotationPdfUrl',
      label: 'Quotation PDF', recordLabel: q.quotationNumber,
      url: q.quotationPdfUrl, uploadedAt: q.createdAt,
      uploadedBy: q.createdBy?.name || null,
    }));

    // 4. PurchaseOrder.poDocumentUrl
    const pos = await prisma.purchaseOrder.findMany({
      where: { poDocumentUrl: { not: null } },
      select: {
        id: true, orderNumber: true, poDocumentUrl: true,
        updatedAt: true, createdBy: { select: { name: true } },
      },
    });
    pos.forEach((o) => uploads.push({
      table: 'PurchaseOrder', recordId: o.id, field: 'poDocumentUrl',
      label: 'Signed PO PDF', recordLabel: o.orderNumber,
      url: o.poDocumentUrl, uploadedAt: o.updatedAt,
      uploadedBy: o.createdBy?.name || null,
    }));

    // 5. QCInspection.invoiceFileUrl
    const qcInv = await prisma.qCInspection.findMany({
      where: { invoiceFileUrl: { not: null } },
      select: { id: true, inspectionNumber: true, invoiceFileUrl: true, createdAt: true },
    });
    qcInv.forEach((q) => uploads.push({
      table: 'QCInspection', recordId: q.id, field: 'invoiceFileUrl',
      label: 'Lot Invoice PDF', recordLabel: q.inspectionNumber,
      url: q.invoiceFileUrl, uploadedAt: q.createdAt, uploadedBy: null,
    }));

    // 6. QCInspection.uploadedDocs — JSON array of {filename, url, uploadedById, uploadedAt}
    const qcDocs = await prisma.qCInspection.findMany({
      where: { uploadedDocs: { not: null } },
      select: { id: true, inspectionNumber: true, uploadedDocs: true },
    });
    // Resolve uploader names in a single round-trip
    const uploaderIds = new Set();
    qcDocs.forEach((q) => {
      if (Array.isArray(q.uploadedDocs)) {
        q.uploadedDocs.forEach((d) => { if (d?.uploadedById) uploaderIds.add(d.uploadedById); });
      }
    });
    const users = uploaderIds.size
      ? await prisma.user.findMany({ where: { id: { in: [...uploaderIds] } }, select: { id: true, name: true } })
      : [];
    const userById = Object.fromEntries(users.map((u) => [u.id, u.name]));
    qcDocs.forEach((q) => {
      if (!Array.isArray(q.uploadedDocs)) return;
      q.uploadedDocs.forEach((d, idx) => {
        if (!d?.url) return;
        uploads.push({
          table: 'QCInspection', recordId: q.id, field: `uploadedDocs[${idx}]`,
          label: `QC Doc: ${d.filename || 'file'}`, recordLabel: q.inspectionNumber,
          url: d.url, uploadedAt: d.uploadedAt || null,
          uploadedBy: userById[d.uploadedById] || null,
        });
      });
    });

    uploads.sort((a, b) => {
      const ta = a.uploadedAt ? new Date(a.uploadedAt).getTime() : 0;
      const tb = b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0;
      return tb - ta;
    });

    res.json({ uploads, total: uploads.length });
  } catch (e) {
    console.error('superadmin/uploads error:', e);
    res.status(500).json({ error: e.message || 'Failed to list uploads' });
  }
});

// DELETE /api/superadmin/uploads — clear the DB reference for one upload.
// Body: { table, recordId, field }. For QCInspection.uploadedDocs the field is
// "uploadedDocs[N]" — we splice the N-th entry from the JSON array.
router.delete('/uploads', async (req, res) => {
  const { table, recordId, field } = req.body || {};
  if (!table || !recordId || !field) return res.status(400).json({ error: 'table, recordId, field required' });

  try {
    // QC uploadedDocs array item
    const arrMatch = /^uploadedDocs\[(\d+)\]$/.exec(field);
    if (arrMatch) {
      if (table !== 'QCInspection') return res.status(400).json({ error: 'uploadedDocs only on QCInspection' });
      const idx = parseInt(arrMatch[1], 10);
      const row = await prisma.qCInspection.findUnique({ where: { id: recordId }, select: { uploadedDocs: true } });
      if (!row) return res.status(404).json({ error: 'Inspection not found' });
      const docs = Array.isArray(row.uploadedDocs) ? [...row.uploadedDocs] : [];
      if (idx < 0 || idx >= docs.length) return res.status(400).json({ error: 'Index out of range' });
      docs.splice(idx, 1);
      await prisma.qCInspection.update({ where: { id: recordId }, data: { uploadedDocs: docs } });
      return res.json({ ok: true });
    }

    const allowed = FILE_FIELDS[table]?.some((f) => f.field === field);
    if (!allowed) return res.status(400).json({ error: 'Field not in deletable allowlist' });

    const key = modelKey(table);
    await prisma[key].update({ where: { id: recordId }, data: { [field]: null } });
    res.json({ ok: true });
  } catch (e) {
    console.error('superadmin/uploads delete error:', e);
    res.status(400).json({ error: e.message || 'Failed to delete upload' });
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

  // Root filesystem usage — the 30 GB EBS volume is the real capacity ceiling.
  try {
    const { stdout } = await execAsync("df -B1 / | awk 'NR==2 {print $2, $3, $4}'");
    const [total, used, available] = stdout.trim().split(/\s+/).map(Number);
    if (total) {
      out.server.disk = {
        total,
        used,
        available,
        percent: Math.round((used / total) * 100),
      };
    }
  } catch (_) { /* dev box, ignore */ }

  // Uploads dir size — visible alongside DB size so you can see what's eating disk.
  try {
    const uploadsPath = path.resolve(__dirname, '../../uploads');
    const { stdout } = await execAsync(`du -sb "${uploadsPath}" 2>/dev/null | cut -f1`);
    out.server.uploadsBytes = parseInt(stdout.trim(), 10) || 0;
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
    // Find the LAST "Backup complete" line — anything before it is ancient history.
    let lastCompleteIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/Backup complete/.test(lines[i])) { lastCompleteIdx = i; break; }
    }
    const lastComplete = lastCompleteIdx >= 0 ? lines[lastCompleteIdx] : null;
    // Only surface errors that occurred AFTER the most recent successful backup —
    // otherwise stale failures (e.g. from before a fix) keep showing forever.
    const errorPool = lastCompleteIdx >= 0 ? lines.slice(lastCompleteIdx + 1) : lines;
    const lastError = [...errorPool].reverse().find((l) => /\bERROR\b|pg_dump: error|copy failed/i.test(l));
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
