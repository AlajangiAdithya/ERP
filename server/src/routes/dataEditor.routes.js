// Edit-only table editor for the DATA_EDITOR role (and SUPERADMIN).
//
// Deliberately a STRICT SUBSET of superadmin.routes.js: it can list tables,
// read/search rows, and UPDATE an existing row — nothing else. No insert, no
// delete, no uploads, no backups, no user/impersonation tools. This is the
// "change a value" hatch for non-technical staff; the destructive power stays
// SUPERADMIN-only.
const express = require('express');
const { Prisma } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');
const { dataEditorOnly } = require('../middleware/dataEditorOnly');
const { resolveTable, listTables } = require('../utils/virtualTables');
const { readTablePage, prismaErrorMessage } = require('../utils/tableRead');
const prisma = require('../config/db');

const router = express.Router();
router.use(authenticate, dataEditorOnly);

// Whitelisted Prisma model names, derived from the schema (DMMF) so every model
// is present and the URL can never drive `prisma[undefined]`.
const TABLES = Prisma.dmmf.datamodel.models.map((m) => m.name);

// Plus the same curated views the SUPERADMIN editor publishes (e.g. "FIM Entry"
// = the FIM subset of GatePass) — see utils/virtualTables.js.
const resolve = (name) => resolveTable(name, TABLES);

// GET /api/data-editor/tables — curated views + every model, with row counts
router.get('/tables', async (req, res) => {
  try {
    const out = await listTables(TABLES, async (key, where) => {
      try {
        return await prisma[key].count(where ? { where } : undefined);
      } catch {
        return null;
      }
    });
    res.json({ tables: out });
  } catch (e) {
    console.error('data-editor/tables error:', e);
    res.status(500).json({ error: 'Failed to list tables' });
  }
});

// GET /api/data-editor/table/:name?page=1&limit=50&q=text
router.get('/table/:name', async (req, res) => {
  const t = resolve(req.params.name);
  if (!t) return res.status(404).json({ error: 'Unknown table' });
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));

  try {
    res.json(await readTablePage(prisma, t, { page, limit, q: req.query.q }));
  } catch (e) {
    console.error(`data-editor/table/${t.name} error:`, e);
    res.status(500).json({ error: `Could not read ${t.name}: ${prismaErrorMessage(e)}` });
  }
});

// PUT /api/data-editor/table/:name/row/:id — partial update (the only write)
router.put('/table/:name/row/:id', async (req, res) => {
  const { id } = req.params;
  const t = resolve(req.params.name);
  if (!t) return res.status(404).json({ error: 'Unknown table' });
  // id/createdAt/updatedAt are managed by Prisma — never let them be overwritten.
  const { id: _id, createdAt, updatedAt, ...data } = req.body || {};
  try {
    // A curated view only reaches its own rows — no editing an outward gate
    // pass through the FIM view.
    if (t.where) {
      const hit = await prisma[t.key].findFirst({ where: { AND: [t.where, { id }] }, select: { id: true } });
      if (!hit) return res.status(404).json({ error: 'Row not found in this view' });
    }
    const updated = await prisma[t.key].update({ where: { id }, data });
    res.json(updated);
  } catch (e) {
    console.error(`data-editor update ${t.name}/${id} error:`, e);
    res.status(400).json({ error: prismaErrorMessage(e) });
  }
});

module.exports = router;
