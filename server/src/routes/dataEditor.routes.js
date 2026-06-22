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
const prisma = require('../config/db');

const router = express.Router();
router.use(authenticate, dataEditorOnly);

// Whitelisted Prisma model names, derived from the schema (DMMF) so every model
// is present and the URL can never drive `prisma[undefined]`.
const TABLES = Prisma.dmmf.datamodel.models.map((m) => m.name);

// PascalCase table name → camelCase Prisma model accessor.
const modelKey = (table) => table.charAt(0).toLowerCase() + table.slice(1);

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

// GET /api/data-editor/tables — table names with row counts
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
    console.error('data-editor/tables error:', e);
    res.status(500).json({ error: 'Failed to list tables' });
  }
});

// GET /api/data-editor/table/:name?page=1&limit=50&q=text
router.get('/table/:name', async (req, res) => {
  const { name } = req.params;
  if (!TABLES.includes(name)) return res.status(404).json({ error: 'Unknown table' });
  const key = modelKey(name);
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
  const q = (req.query.q || '').trim();

  let where;
  if (q) {
    const fields = searchableFields(name);
    if (fields.length) {
      where = { OR: fields.map((f) => ({ [f]: { contains: q, mode: 'insensitive' } })) };
    }
  }
  const findArgs = { skip: (page - 1) * limit, take: limit, ...(where && { where }) };
  const countArgs = where ? { where } : undefined;

  try {
    const [rows, total] = await Promise.all([
      prisma[key].findMany({ ...findArgs, orderBy: { createdAt: 'desc' } }),
      prisma[key].count(countArgs),
    ]);
    res.json({ rows, total, page, totalPages: Math.ceil(total / limit) });
  } catch (e) {
    // Tables without createdAt fall back to no ordering
    try {
      const [rows, total] = await Promise.all([
        prisma[key].findMany(findArgs),
        prisma[key].count(countArgs),
      ]);
      res.json({ rows, total, page, totalPages: Math.ceil(total / limit) });
    } catch (e2) {
      console.error(`data-editor/table/${name} error:`, e2);
      res.status(500).json({ error: 'Failed to read table' });
    }
  }
});

// PUT /api/data-editor/table/:name/row/:id — partial update (the only write)
router.put('/table/:name/row/:id', async (req, res) => {
  const { name, id } = req.params;
  if (!TABLES.includes(name)) return res.status(404).json({ error: 'Unknown table' });
  const key = modelKey(name);
  // id/createdAt/updatedAt are managed by Prisma — never let them be overwritten.
  const { id: _id, createdAt, updatedAt, ...data } = req.body || {};
  try {
    const updated = await prisma[key].update({ where: { id }, data });
    res.json(updated);
  } catch (e) {
    console.error(`data-editor update ${name}/${id} error:`, e);
    res.status(400).json({ error: prismaErrorMessage(e) });
  }
});

module.exports = router;
