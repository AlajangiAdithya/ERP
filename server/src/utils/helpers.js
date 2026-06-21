const paginate = (page = 1, limit = 20) => {
  const rawP = parseInt(page, 10);
  const rawL = parseInt(limit, 10);
  const p = Number.isFinite(rawP) && rawP > 0 ? rawP : 1;
  const l = Number.isFinite(rawL) && rawL > 0 ? Math.min(1000, rawL) : 20;
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
// 'Hand Tools & Fastners' was split into two distinct categories: 'Hand Tools'
// (no QC on inward) and 'Fasteners' (normal QC). The combined label is kept in
// normalizeMaterialType() so legacy products keep their existing category.
const MATERIAL_TYPES = ['Raw Material', 'Consumable', 'Hand Tools', 'Fasteners', 'Tools & Fixtures', 'Stationery', 'Others'];

const materialTypeToSkuPrefix = (materialType) => {
  switch ((materialType || '').trim().toLowerCase()) {
    case 'raw material':           return 'RAW';
    case 'consumable':             return 'CONS';
    case 'hand tools':             return 'TOOL';
    case 'hand tools & fastners':  return 'TOOL';
    case 'tooling':                return 'TOOL';
    case 'fasteners':              return 'FAST';
    case 'fastners':               return 'FAST';
    case 'tools & fixtures':       return 'FIX';
    case 'tools and fixtures':     return 'FIX';
    case 'stationery':             return 'STAT';
    case 'stationary':             return 'STAT';
    default:                       return 'OTH';
  }
};

const normalizeMaterialType = (value) => {
  if (!value) return 'Others';
  const t = String(value).trim().toLowerCase();
  if (t === 'raw material' || t === 'raw' || t === 'raw_material') return 'Raw Material';
  if (t === 'consumable' || t === 'consumables') return 'Consumable';
  // New split categories. 'tooling'/'tool' now map to Hand Tools.
  if (t === 'hand tools' || t === 'hand tool' || t === 'tooling' || t === 'tool') return 'Hand Tools';
  if (t === 'fasteners' || t === 'fastners' || t === 'fastener' || t === 'fastner') return 'Fasteners';
  // Legacy combined label — kept intact so existing products are not re-bucketed.
  if (
    t === 'hand tools & fastners' ||
    t === 'hand tools and fastners'
  ) return 'Hand Tools & Fastners';
  if (
    t === 'tools & fixtures' ||
    t === 'tools and fixtures' ||
    t === 'tooling & fixtures' ||
    t === 'tooling and fixtures' ||
    t === 'fixtures' ||
    t === 'fixture'
  ) return 'Tools & Fixtures';
  if (t === 'stationery' || t === 'stationary') return 'Stationery';
  return 'Others';
};

// ──── Document numbering: RAPS/<KIND>/<FY>/<N> ────
// Counter resets every Indian financial year (Apr 1 – Mar 31), per kind.
// Plain number (no zero-padding). Old records keep their legacy format.
// On unique-constraint collision we retry — handles concurrent inserts.
const DOC_NUMBER_MAP = {
  PR:  { model: 'purchaseRequest',          field: 'requestNumber' },
  PO:  { model: 'purchaseOrder',            field: 'orderNumber' },
  MIV: { model: 'productRequest',           field: 'requestNumber' },
  GP:  { model: 'gatePass',                 field: 'passNumber' },
  FIM: { model: 'gatePass',                 field: 'fimNumber' },
  ION: { model: 'interOfficeNote',          field: 'ionNumber' },
  QT:  { model: 'quotation',                field: 'quotationNumber' },
  QC:  { model: 'qCInspection',             field: 'inspectionNumber' },
  MIR: { model: 'materialInwardRegister',   field: 'mirNo' },
  IION:{ model: 'materialInwardRegister',   field: 'ionNo' }, // Inward Inspection ION No.
  IR:  { model: 'qCInspection',             field: 'reportNo' },
  ISS: { model: 'productRequest',           field: 'issueNo' },
  PAY: { model: 'paymentRequest',           field: 'paymentNumber' },
  TRF: { model: 'inventoryTransferRequest', field: 'transferNumber' },
  WO:  { model: 'workOrder',                field: 'workOrderNumber' },
  TRIP:{ model: 'vehicleTrip',              field: 'tripNumber' },
  INV: { model: 'workOrderClosure',         field: 'invoiceNumber' },
  WOQC:{ model: 'workOrderClosure',         field: 'qcCertificateNumber' },
};

const formatDDMMYY = (date = new Date()) => {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = String(date.getFullYear()).slice(-2);
  return `${d}-${m}-${y}`;
};

// Indian financial year label: Apr 1 starts a new FY. e.g. 23 May 2026 → "26-27",
// 15 Feb 2027 → "26-27", 5 Apr 2027 → "27-28".
const getFinancialYear = (date = new Date()) => {
  const y = date.getFullYear();
  const isAfterApril = date.getMonth() >= 3; // 0-indexed: 3 = April
  const startYear = isAfterApril ? y : y - 1;
  const endYear = startYear + 1;
  return `${String(startYear).slice(-2)}-${String(endYear).slice(-2)}`;
};

// ──── Live-cutover count starts ────
// This system went live partway through a financial year, after PR/PO/MIV/MIR
// numbers had already been issued on the previous (manual) system. Each value is
// the FIRST number to issue this FY — the next document of that kind starts here
// and counts up (unless a live record has already passed it, in which case that
// record wins). Keyed by financial year, so any year NOT listed simply starts
// from 1 again — e.g. FY 27-28 restarts the count from scratch.
const DOC_NUMBER_START = {
  '26-27': { PR: 83, PO: 101, MIV: 1, MIR: 1 },
};

// The cutover floor for (kind, FY): the next number is max(existing)+1 but never
// below the configured start. We express the start S as a floor of (S - 1) so the
// shared max+1 logic keeps working — first issue lands exactly on S.
const baselineFor = (kind, date = new Date()) => {
  const start = DOC_NUMBER_START[getFinancialYear(date)]?.[kind];
  return start ? start - 1 : 0;
};

// Compute the next plain count for (kind, FY). Reads existing numbers matching the
// `RAPS/<KIND>/<FY>/` prefix and returns max+1, never below the cutover `floor`
// (= start - 1, see baselineFor). Caller must catch P2002 and retry.
const nextFyCount = async (prisma, modelName, field, prefix, floor = 0) => {
  const rows = await prisma[modelName].findMany({
    where: { [field]: { startsWith: prefix } },
    select: { [field]: true },
  });
  let max = floor;
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
  const prefix = `RAPS/${kind}/${getFinancialYear(date)}/`;
  const next = await nextFyCount(prisma, meta.model, meta.field, prefix, baselineFor(kind, date));
  return `${prefix}${next}`;
};

// MIR uses the same FY-scoped scheme but lives on PurchaseOrder.mirNo.
const generateMirNumber = async (prisma, date = new Date()) => {
  const prefix = `RAPS/MIR/${getFinancialYear(date)}/`;
  const next = await nextFyCount(prisma, 'purchaseOrder', 'mirNo', prefix, baselineFor('MIR', date));
  return `${prefix}${next}`;
};

// Product ID: a single running serial shared by every product (no category
// prefix) — 001, 002, 003 … One global counter so the IDs form one continuous
// series; zero-padded to 3 digits and grows naturally past 999. The legacy
// CONS-/RAW-/TOOL- prefixed codes are ignored when finding the next number.
// `materialType` is accepted but unused, so existing call sites need no change.
const generateProductSku = async (prisma, _materialType) => {
  const rows = await prisma.product.findMany({ select: { sku: true } });
  let max = 0;
  for (const { sku } of rows) {
    const s = (sku || '').trim();
    if (!/^\d+$/.test(s)) continue; // skip legacy prefixed codes (e.g. CONS-0001)
    const n = parseInt(s, 10);
    if (n > max) max = n;
  }
  return String(max + 1).padStart(3, '0');
};

// ──── DEPARTMENT OWNERSHIP ────
// Non-unit requester roles that "own" the stock they raise PRs for. Their inwarded
// stock is reserved to the department (ProductDeptStock) and excluded from the
// unassigned pool, so only they can issue it; others must raise an inventory
// transfer. STORE_MANAGER is intentionally absent — Stores-raised stock stays the
// shared/general pool. Unit-bound roles (MANAGER, RND) reserve to a unit instead.
// Labels match the Direct-Entry ASSIGN_DEPTS list so PO-flow and cash-flow agree.
const DEPT_BY_ROLE = {
  DESIGNS: 'Designs',
  QC: 'QC',
  LAB: 'Lab',
  METROLOGY: 'Metrology',
  NDT: 'NDT',
  SAFETY: 'Safety',
  // PLANNING is an org-wide overseer that ALSO raises/issues its own material;
  // its inwarded stock reserves to a dedicated "Planning" bucket, same as the
  // other non-unit owner departments above.
  PLANNING: 'Planning',
};

// Canonical set of department owner labels (the values of DEPT_BY_ROLE).
const OWNER_DEPTS = Object.values(DEPT_BY_ROLE);

// Department label a given role owns stock under, or null for unit-bound / non-owner roles.
const deptForRole = (role) => DEPT_BY_ROLE[role] || null;

// ──── Work Order auto-accept units ────
// Units whose assigned work orders skip the unit-manager accept/reject step —
// they are accepted automatically on assignment. SHAR is a site location with
// no unit manager, so its WOs go straight to UNIT_ACCEPTED. Match on unit code
// OR name, case-insensitive.
const AUTO_ACCEPT_UNIT_NAMES = ['SHAR'];

const isAutoAcceptUnit = (unit) => {
  if (!unit) return false;
  const code = String(unit.code || '').trim().toUpperCase();
  const name = String(unit.name || '').trim().toUpperCase();
  return AUTO_ACCEPT_UNIT_NAMES.some((u) => u === code || u === name);
};

// Validate an optional Work Order link supplied when raising a PR / MIV.
// Returns { ok: true, workOrderId } (workOrderId is null when none was chosen)
// or { ok: false, error } so the caller can respond with 400. A unit-bound
// requester may only link a WO assigned to their own unit; cancelled/rejected
// WOs are never linkable.
const validateWorkOrderLink = async (prisma, rawWorkOrderId, requesterUnitId) => {
  const workOrderId = rawWorkOrderId || null;
  if (!workOrderId) return { ok: true, workOrderId: null };
  const wo = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    select: { id: true, assignedUnitId: true, status: true },
  });
  if (!wo || ['CANCELLED', 'REJECTED'].includes(wo.status)) {
    return { ok: false, error: 'Selected work order is not valid' };
  }
  if (requesterUnitId && wo.assignedUnitId !== requesterUnitId) {
    return { ok: false, error: 'Selected work order is not assigned to your unit' };
  }
  return { ok: true, workOrderId: wo.id };
};

const isUniqueViolation = (err) => err && err.code === 'P2002';

// Retry wrapper for doc-number races. Reads the existing max, builds the next
// number, and creates the row — if two concurrent requests pick the same
// number, the loser hits P2002 and we re-read. Don't wrap an outer
// $transaction in this; retry the transaction itself from outside instead.
const withDocRetry = async (fn, attempts = 5) => {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!isUniqueViolation(err) || i === attempts - 1) throw err;
    }
  }
};

module.exports = {
  paginate,
  applyDateFilter,
  MATERIAL_TYPES,
  materialTypeToSkuPrefix,
  normalizeMaterialType,
  formatDDMMYY,
  getFinancialYear,
  generateMirNumber,
  generateSequentialNumber,
  generateProductSku,
  isUniqueViolation,
  withDocRetry,
  DEPT_BY_ROLE,
  OWNER_DEPTS,
  deptForRole,
  AUTO_ACCEPT_UNIT_NAMES,
  isAutoAcceptUnit,
  validateWorkOrderLink,
};
