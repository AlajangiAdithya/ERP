// Shared paged reader behind both raw row editors (/superadmin and /data-editor).
//
// Previously each route ordered by createdAt and relied on the query THROWING to
// discover that a model has no such column — 16 of the 84 models (every
// line-item table: GatePassItem, PurchaseRequestItem, WorkOrderItem, …) took
// that path on every single read. Two problems with that: a guaranteed-to-fail
// query per request, and any *genuine* error got hidden behind the retry and
// reported as a flat "Failed to read table".
//
// Here the shape of each model is read from the Prisma schema (DMMF) up front,
// so the right query is built the first time and a real failure stays visible.
const { Prisma } = require('@prisma/client');
const { toOneRelations, relationInclude, decorateRow } = require('./rowLabels');
const { scopedWhere } = require('./virtualTables');

// Per-model facts we need on every read, resolved once from the schema.
const _meta = {};
function modelMeta(name) {
  if (_meta[name]) return _meta[name];
  const m = Prisma.dmmf.datamodel.models.find((x) => x.name === name);
  const meta = {
    exists: !!m,
    hasCreatedAt: !!m?.fields.some((f) => f.name === 'createdAt'),
    // Scalar String columns drive the case-insensitive "search this table" OR
    // filter. id is a String too, so an exact/partial id search works for free.
    stringFields: m
      ? m.fields.filter((f) => f.kind === 'scalar' && f.type === 'String' && !f.isList).map((f) => f.name)
      : [],
  };
  _meta[name] = meta;
  return meta;
}

// Raw Prisma errors are multi-line stack-like blobs; translate the common codes
// into something an operator can act on in the editor's error banner.
function prismaErrorMessage(e) {
  switch (e?.code) {
    case 'P2002': {
      const fields = Array.isArray(e.meta?.target) ? e.meta.target.join(', ') : e.meta?.target;
      return `Unique constraint failed${fields ? ` on: ${fields}` : ''} — another row already has this value.`;
    }
    case 'P2003':
      return 'Row is referenced by other records (foreign key constraint). Delete or re-point the dependent rows first.';
    case 'P2025':
      return 'Row not found — it may have been deleted already.';
    case 'P2024':
      return 'Database connection pool timed out — the server is busy. Try again in a moment.';
    default:
      return (e?.message || 'Operation failed').split('\n').filter(Boolean).pop().trim();
  }
}

// One page of a table (or of a curated view). `t` is a resolveTable() result.
// Throws the underlying Prisma error so the caller can report the real reason.
async function readTablePage(prisma, t, { page = 1, limit = 50, q = '' } = {}) {
  const meta = modelMeta(t.model);
  const term = (q || '').trim();

  let search;
  if (term && meta.stringFields.length) {
    search = { OR: meta.stringFields.map((f) => ({ [f]: { contains: term, mode: 'insensitive' } })) };
  }
  // A curated view's scope is non-negotiable — the search only narrows it.
  const where = scopedWhere(t.where, search);

  const rels = toOneRelations(t.model);
  const include = relationInclude(rels);
  const base = { skip: (page - 1) * limit, take: limit, ...(where && { where }) };
  // Only order by createdAt when the model actually has it.
  const orderBy = meta.hasCreatedAt ? { createdAt: 'desc' } : undefined;
  const countArgs = where ? { where } : undefined;

  const run = async (withLabels) => {
    const args = { ...base, ...(orderBy && { orderBy }), ...(withLabels && include ? { include } : {}) };
    const [rows, total] = await Promise.all([
      prisma[t.key].findMany(args),
      prisma[t.key].count(countArgs),
    ]);
    // decorateRow strips the joined relation objects and leaves _labels/_rowLabel.
    rows.forEach((r) => decorateRow(r, withLabels ? rels : []));
    return {
      rows,
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      labelsResolved: !!(withLabels && include),
      // Which columns the LISTING should show, in order. Only curated views set
      // this; everything else keeps the old behaviour of showing every column.
      // The rows themselves are never trimmed, so the editor still reaches every
      // field on the row.
      columns: t.columns ? ['id', ...t.columns.filter((c) => c !== 'id')] : null,
    };
  };

  if (!include) return run(false);
  try {
    return await run(true);
  } catch (e) {
    // Resolving foreign keys to readable names is a nicety — it must never be
    // the reason a table won't open. Retry plain; if that fails too, the error
    // is real and belongs to the caller.
    return run(false);
  }
}

module.exports = { readTablePage, modelMeta, prismaErrorMessage };
