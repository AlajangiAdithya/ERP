const generateOrderNumber = (prefix) => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
};

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

// Generates a daily-reset MIR number MIR-YYYYMMDD-NNN.
// Counter resets each day by counting existing MIRs assigned for today's date.
// Pass a Prisma client to query the live counter.
const generateMirNumber = async (prisma) => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const datePart = `${y}${m}${d}`;
  const prefix = `MIR-${datePart}-`;

  // Find the highest existing counter for today's prefix across PurchaseOrder.mirNo
  const todays = await prisma.purchaseOrder.findMany({
    where: { mirNo: { startsWith: prefix } },
    select: { mirNo: true },
  });
  let max = 0;
  for (const { mirNo } of todays) {
    const n = parseInt(mirNo.slice(prefix.length), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  const next = String(max + 1).padStart(3, '0');
  return `${prefix}${next}`;
};

// ──── Standard document numbering: RAPS/<TYPE>/<MM>/<YY-YY>/<NNN> ────
// Counter is scoped per (type, financial year). Indian FY runs April–March:
// e.g. May 2026 → FY 26-27; February 2026 → FY 25-26.
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
};

const computeFinancialYear = (date = new Date()) => {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const startYear = m >= 4 ? y : y - 1;
  const endYear = startYear + 1;
  return `${String(startYear).slice(-2)}-${String(endYear).slice(-2)}`;
};

const generateSequentialNumber = async (prisma, kind) => {
  const meta = DOC_NUMBER_MAP[kind];
  if (!meta) throw new Error(`Unknown document kind: ${kind}`);
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const fy = computeFinancialYear(now);
  const typePrefix = `RAPS/${kind}/`;
  const fySegment = `/${fy}/`;

  const rows = await prisma[meta.model].findMany({
    where: {
      AND: [
        { [meta.field]: { startsWith: typePrefix } },
        { [meta.field]: { contains: fySegment } },
      ],
    },
    select: { [meta.field]: true },
  });

  let max = 0;
  for (const row of rows) {
    const val = row[meta.field];
    if (!val) continue;
    const parts = val.split('/');
    // Expected shape: RAPS / KIND / MM / YY-YY / NNN  → 5 parts
    if (parts.length !== 5) continue;
    if (parts[1] !== kind || parts[3] !== fy) continue;
    const n = parseInt(parts[4], 10);
    if (!isNaN(n) && n > max) max = n;
  }
  const next = String(max + 1).padStart(3, '0');
  return `RAPS/${kind}/${month}/${fy}/${next}`;
};

// Product SKU: RAPS/SKU/<NNNN>. Counter is global (not FY-scoped) because
// a SKU is a permanent product identifier, not a financial-year document.
const generateProductSku = async (prisma) => {
  const prefix = 'RAPS/SKU/';
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

module.exports = {
  generateOrderNumber,
  paginate,
  applyDateFilter,
  generateMirNumber,
  generateSequentialNumber,
  generateProductSku,
  computeFinancialYear,
};
