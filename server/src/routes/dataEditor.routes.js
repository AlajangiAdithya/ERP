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
const { toOneRelations, relationInclude, decorateRow } = require('../utils/rowLabels');
const { resolveTable, scopedWhere, listTables } = require('../utils/virtualTables');
const prisma = require('../config/db');

const router = express.Router();
router.use(authenticate, dataEditorOnly);

// Whitelisted Prisma model names, derived from the schema (DMMF) so every model
// is present and the URL can never drive `prisma[undefined]`.
const TABLES = Prisma.dmmf.datamodel.models.map((m) => m.name);

// Plus the same curated views the SUPERADMIN editor publishes (e.g. "FIM Entry"
// = the FIM subset of GatePass) — see utils/virtualTables.js.
const resolve = (name) => resolveTable(name, TABLES);

// Scalar String fields of a model, cached — drives the case-insensitive
// "search this table" OR filter.
const _searchFieldCache = {};
const searchableFields = (modelName) => {
  if (_searchFieldCache[modelName]) return _searchFieldCache[modelName];
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === modelName);
  const fields = model
    ? model.fields
        .filter((f) => f.kind === 'scalar' && f.type === 'String' && !f.isList)
        .map((f) => f.name)
    : [];
  _searchFieldCache[modelName] = fields;
  return fields;
};

// Translate the common Prisma error codes into a readable banner message.
const prismaErrorMessage = (e) => {
  switch (e.code) {
    case 'P2002': {
      const fields = Array.isArray(e.meta?.target) ? e.meta.target.join(', ') : e.meta?.target;
      return `Unique constraint failed${fields ? ` on: ${fields}` : ''} — another row already has this value.`;
    }
    case 'P2003':
      return 'Row is referenced by other records (foreign key constraint).';
    case 'P2025':
      return 'Row not found — it may have been deleted already.';
    default:
      return (e.message || 'Operation failed').split('\n').filter(Boolean).pop().trim();
  }
};

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
  const { key } = t;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
  const q = (req.query.q || '').trim();

  let search;
  if (q) {
    const fields = searchableFields(t.model);
    if (fields.length) {
      search = { OR: fields.map((f) => ({ [f]: { contains: q, mode: 'insensitive' } })) };
    }
  }
  // A curated view's scope is non-negotiable — the search only narrows it.
  const where = scopedWhere(t.where, search);
  // Resolve foreign-key ids to readable names (productId → "Acetone", etc.).
  const rels = toOneRelations(t.model);
  const include = relationInclude(rels);
  const findArgs = { skip: (page - 1) * limit, take: limit, ...(where && { where }), ...(include && { include }) };
  const countArgs = where ? { where } : undefined;

  try {
    const [rows, total] = await Promise.all([
      prisma[key].findMany({ ...findArgs, orderBy: { createdAt: 'desc' } }),
      prisma[key].count(countArgs),
    ]);
    rows.forEach((r) => decorateRow(r, rels));
    res.json({ rows, total, page, totalPages: Math.ceil(total / limit) });
  } catch (e) {
    // Tables without createdAt fall back to no ordering
    try {
      const [rows, total] = await Promise.all([
        prisma[key].findMany(findArgs),
        prisma[key].count(countArgs),
      ]);
      rows.forEach((r) => decorateRow(r, rels));
      res.json({ rows, total, page, totalPages: Math.ceil(total / limit) });
    } catch (e2) {
      console.error(`data-editor/table/${t.name} error:`, e2);
      res.status(500).json({ error: 'Failed to read table' });
    }
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
