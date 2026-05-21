const paginate = (page = 1, limit = 20) => {
  const p = Math.max(1, parseInt(page));
  const l = Math.min(1000, Math.max(1, parseInt(limit)));
  return { skip: (p - 1) * l, take: l, page: p, limit: l };
};

const applyDateFilter = (where, { fromDate, toDate }, field = 'createdAt') => {
  if (fromDate || toDate) {
    where[field] = {};
    if (fromDate) where[field].gte = new Date(fromDate);
    if (toDate) {
      const end = new Date(toDate);
      end.setHours(23, 59, 59, 999);
      where[field].lte = end;
    }
  }
};

// ──── Material types (fixed dropdown shared by PR items, Products, QC, SKU prefix) ────
const MATERIAL_TYPES = ['Raw Material', 'Consumable', 'Tooling', 'Others'];

const materialTypeToSkuPrefix = (materialType) => {
  switch ((materialType || '').trim().toLowerCase()) {
    case 'raw material': return 'RAW';
    case 'consumable':   return 'CONS';
    case 'tooling':      return 'TOOL';
    default:             return 'OTH';
  }
};

const normalizeMaterialType = (value) => {
  if (!value) return 'Others';
  const t = String(value).trim().toLowerCase();
  if (t === 'raw material' || t === 'raw' || t === 'raw_material') return 'Raw Material';
  if (t === 'consumable' || t === 'consumables') return 'Consumable';
  if (t === 'tooling' || t === 'tool' || t === 'tooling & fixtures') return 'Tooling';
  return 'Others';
};

// ──── Document numbering: <KIND>/<DD-MM-YY>/<N> ────
// Counter resets daily, per kind. Plain number (no zero-padding).
// On unique-constraint collision we retry — handles concurrent inserts.
const DOC_NUMBER_MAP = {
  PR:  { model: 'purchaseRequest',          field: 'requestNumber' },
  PO:  { model: 'purchaseOrder',            field: 'orderNumber' },
  MIV: { model: 'productRequest',           field: 'requestNumber' },
  GP:  { model: 'gatePass',                 field: 'passNumber' },
  ION: { model: 'interOfficeNote',          field: 'ionNumber' },
  QT:  { model: 'quotation',                field: 'quotationNumber' },
  QC:  { model: 'qCInspection',             field: 'inspectionNumber' },
  PAY: { model: 'paymentRequest',           field: 'paymentNumber' },
  TRF: { model: 'inventoryTransferRequest', field: 'transferNumber' },
  TND: { model: 'tender',                   field: 'tenderNumber' },
};

const formatDDMMYY = (date = new Date()) => {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = String(date.getFullYear()).slice(-2);
  return `${d}-${m}-${y}`;
};

// Compute the next plain count for (kind, day). Reads existing numbers matching the
// `<KIND>/<DD-MM-YY>/` prefix and returns max+1. Caller must catch P2002 and retry.
const nextDailyCount = async (prisma, modelName, field, prefix) => {
  const rows = await prisma[modelName].findMany({
    where: { [field]: { startsWith: prefix } },
    select: { [field]: true },
  });
  let max = 0;
  for (const row of rows) {
    const val = row[field];
    if (!val) continue;
    const tail = val.slice(prefix.length);
    const n = parseInt(tail, 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return max + 1;
};

const generateSequentialNumber = async (prisma, kind, date = new Date()) => {
  const meta = DOC_NUMBER_MAP[kind];
  if (!meta) throw new Error(`Unknown document kind: ${kind}`);
  const prefix = `${kind}/${formatDDMMYY(date)}/`;
  const next = await nextDailyCount(prisma, meta.model, meta.field, prefix);
  return `${prefix}${next}`;
};

// MIR uses the same day-scoped scheme but lives on PurchaseOrder.mirNo.
const generateMirNumber = async (prisma, date = new Date()) => {
  const prefix = `MIR/${formatDDMMYY(date)}/`;
  const next = await nextDailyCount(prisma, 'purchaseOrder', 'mirNo', prefix);
  return `${prefix}${next}`;
};

// Product SKU: <PREFIX>-<NNNN> where PREFIX is RAW/CONS/TOOL/OTH.
// Counter is global per prefix (not day-scoped) since a SKU is permanent.
const generateProductSku = async (prisma, materialType) => {
  const prefix = `${materialTypeToSkuPrefix(materialType)}-`;
  const rows = await prisma.product.findMany({
    where: { sku: { startsWith: prefix } },
    select: { sku: true },
  });
  let max = 0;
  for (const { sku } of rows) {
    const n = parseInt(sku.slice(prefix.length), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  const next = String(max + 1).padStart(4, '0');
  return `${prefix}${next}`;
};

// Generic retry wrapper for unique-constraint races on doc numbers.
// Usage:  await withDocNumberRetry(() => generateSequentialNumber(prisma, 'PR'), (num) => prisma.purchaseRequest.create({ ... }))
// Simpler pattern in callers: wrap the create() call in try/catch and re-generate on P2002.
const isUniqueViolation = (err) => err && err.code === 'P2002';

module.exports = {
  paginate,
  applyDateFilter,
  MATERIAL_TYPES,
  materialTypeToSkuPrefix,
  normalizeMaterialType,
  formatDDMMYY,
  generateMirNumber,
  generateSequentialNumber,
  generateProductSku,
  isUniqueViolation,
};
