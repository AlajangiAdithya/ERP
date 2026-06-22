// Helpers that make raw table rows readable for non-technical editors: instead
// of showing UUID foreign keys (e.g. productId = "247f9634-…"), we resolve each
// to-one relation to the related record's human name (e.g. "Acetone") and give
// every row a friendly label.
//
// Used by the /data-editor and /superadmin table readers. The resolved values
// are attached as `_labels` (keyed by the FK scalar field) and `_rowLabel`; the
// raw scalar columns (including the FK ids the editor still needs) are untouched.
const { Prisma } = require('@prisma/client');

// Priority list of "name-like" columns. The first one present on a record wins
// as its display label. Falls back to the id when none match.
const LABEL_FIELDS = [
  'name', 'fullName', 'displayName',
  'requestNumber', 'workOrderNumber', 'orderNumber', 'quotationNumber',
  'passNumber', 'mirNo', 'inspectionNumber', 'sessionNumber', 'certificateNo',
  'sku', 'title', 'subject', 'docNo', 'regNumber', 'rapsId', 'rapsplSerialNo',
  'username', 'empCode', 'label', 'code', 'email',
];

function pickLabel(obj) {
  if (!obj) return null;
  for (const f of LABEL_FIELDS) {
    if (obj[f] != null && obj[f] !== '') return String(obj[f]);
  }
  return obj.id != null ? String(obj.id) : null;
}

// To-one relations OWNED by this model (the FK scalar lives on this row), e.g.
// ProductRequest.workOrder → { relation: 'workOrder', fk: 'workOrderId' }.
function toOneRelations(modelName) {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === modelName);
  if (!model) return [];
  return model.fields
    .filter((f) => f.kind === 'object' && !f.isList && Array.isArray(f.relationFromFields) && f.relationFromFields.length === 1)
    .map((f) => ({ relation: f.name, fk: f.relationFromFields[0] }));
}

// Prisma `include` object for the given relations (or undefined if none).
function relationInclude(rels) {
  return rels.length ? Object.fromEntries(rels.map((r) => [r.relation, true])) : undefined;
}

// Mutates a fetched row in place: extracts FK labels, strips the heavy relation
// objects, and adds `_labels` + `_rowLabel`.
function decorateRow(row, rels) {
  const labels = {};
  for (const r of rels) {
    const related = row[r.relation];
    if (related) {
      const l = pickLabel(related);
      if (l != null) labels[r.fk] = l;
    }
    delete row[r.relation]; // keep payload lean — the FK id scalar stays
  }
  row._labels = labels;
  // Prefer the row's own name; otherwise borrow the first resolved FK label.
  row._rowLabel = pickLabel(row) || Object.values(labels)[0] || (row.id != null ? String(row.id) : '');
  return row;
}

module.exports = { toOneRelations, relationInclude, decorateRow, pickLabel };
