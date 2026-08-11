// FIM data editor — full edit access over FIM / customer-property records for
// ADMIN (and SUPERADMIN, who bypasses every role check).
//
// Same machinery as the SUPERADMIN table editor, but the catalogue is fixed to
// the four FIM tables: the register entries, their lines, the stock batches the
// material produced, and the customer test certificates. An admin can read,
// insert, update and delete within those; any other table name 404s, so this
// route can never become a general-purpose database editor.
//
// Unlike the SUPERADMIN page, actions here ARE audit-logged — an admin is a
// named user, and edits to customer property should be attributable.
const express = require('express');
const { Prisma } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { auditLog } = require('../middleware/audit');
const { resolveTable, listTables, modelKey, FIM_TABLES } = require('../utils/virtualTables');
const { readTablePage, prismaErrorMessage } = require('../utils/tableRead');
const prisma = require('../config/db');

const router = express.Router();
router.use(authenticate, authorize('ADMIN'));

const TABLES = Prisma.dmmf.datamodel.models.map((m) => m.name);

// Resolve a table name, but ONLY if it is part of the FIM surface.
const resolve = (name) => (FIM_TABLES.includes(name) ? resolveTable(name, TABLES) : null);

// Rows reached through a curated view must belong to that view, so the FIM
// tables can't be used to touch an unrelated gate pass or a non-FIM batch.
async function inScope(t, id) {
  if (!t.where) return true;
  const hit = await prisma[t.key].findFirst({ where: { AND: [t.where, { id }] }, select: { id: true } });
  return !!hit;
}

// GET /api/fim-editor/tables — the FIM catalogue with row counts
router.get('/tables', async (req, res) => {
  try {
    const out = await listTables(TABLES, async (key, where) => {
      try {
        return await prisma[key].count(where ? { where } : undefined);
      } catch {
        return null;
      }
    }, { only: FIM_TABLES });
    res.json({ tables: out });
  } catch (e) {
    console.error('fim-editor/tables error:', e);
    res.status(500).json({ error: 'Failed to list FIM tables' });
  }
});

// GET /api/fim-editor/table/:name?page=1&limit=50&q=text
router.get('/table/:name', async (req, res) => {
  const t = resolve(req.params.name);
  if (!t) return res.status(404).json({ error: 'Unknown table' });
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));

  try {
    res.json(await readTablePage(prisma, t, { page, limit, q: req.query.q }));
  } catch (e) {
    console.error(`fim-editor/table/${t.name} error:`, e);
    res.status(500).json({ error: `Could not read ${t.name}: ${prismaErrorMessage(e)}` });
  }
});

// PUT /api/fim-editor/table/:name/row/:id — update any field on a FIM row.
// id/createdAt/updatedAt stay off-limits: they identify the row rather than
// describe the FIM, and rewriting a primary key here has no legitimate use.
router.put('/table/:name/row/:id', auditLog('UPDATE', 'FIM'), async (req, res) => {
  const { id } = req.params;
  const t = resolve(req.params.name);
  if (!t) return res.status(404).json({ error: 'Unknown table' });
  const { id: _id, createdAt, updatedAt, ...data } = req.body || {};
  try {
    if (!(await inScope(t, id))) return res.status(404).json({ error: 'Row not found in this view' });
    const updated = await prisma[t.key].update({ where: { id }, data });
    res.json(updated);
  } catch (e) {
    console.error(`fim-editor update ${t.name}/${id} error:`, e);
    res.status(400).json({ error: prismaErrorMessage(e) });
  }
});

// POST /api/fim-editor/table/:name/row — insert a FIM row
router.post('/table/:name/row', auditLog('CREATE', 'FIM'), async (req, res) => {
  const t = resolve(req.params.name);
  if (!t) return res.status(404).json({ error: 'Unknown table' });
  try {
    // A row created from a curated view has to land inside it: the parent is
    // checked first (when the view is scoped through a relation) and the view's
    // defining columns are forced on last.
    if (t.parent) {
      const parentId = req.body?.[t.parent.fk];
      const ok = parentId && await prisma[modelKey(t.parent.model)]
        .findFirst({ where: { AND: [t.parent.where, { id: parentId }] }, select: { id: true } });
      if (!ok) return res.status(400).json({ error: `${t.parent.fk} must reference a FIM entry` });
    }
    const created = await prisma[t.key].create({ data: { ...req.body, ...(t.createDefaults || {}) } });
    res.status(201).json(created);
  } catch (e) {
    console.error(`fim-editor create ${t.name} error:`, e);
    res.status(400).json({ error: prismaErrorMessage(e) });
  }
});

// DELETE /api/fim-editor/table/:name/row/:id
router.delete('/table/:name/row/:id', auditLog('DELETE', 'FIM'), async (req, res) => {
  const { id } = req.params;
  const t = resolve(req.params.name);
  if (!t) return res.status(404).json({ error: 'Unknown table' });
  try {
    if (!(await inScope(t, id))) return res.status(404).json({ error: 'Row not found in this view' });
    await prisma[t.key].delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) {
    console.error(`fim-editor delete ${t.name}/${id} error:`, e);
    res.status(400).json({ error: prismaErrorMessage(e) });
  }
});

module.exports = router;
