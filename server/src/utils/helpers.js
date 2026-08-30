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
// 'Machinery' also skips QC on inward — it's inwarded straight into the store.
// 'Electrical Items' behaves like any ordinary category (normal QC on inward).
const MATERIAL_TYPES = ['Raw Material', 'Consumable', 'Hand Tools', 'Fasteners', 'Tools & Fixtures', 'Machinery', 'Electrical Items', 'Stationery', 'Others'];

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
    case 'machinery':              return 'MACH';
    case 'machineries':            return 'MACH';
    case 'electrical items':       return 'ELEC';
    case 'electrical item':        return 'ELEC';
    case 'electrical':             return 'ELEC';
    case 'electricals':            return 'ELEC';
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
  if (t === 'machinery' || t === 'machineries' || t === 'machine') return 'Machinery';
  if (
    t === 'electrical items' ||
    t === 'electrical item' ||
    t === 'electrical' ||
    t === 'electricals' ||
    t === 'electric items' ||
    t === 'electrical goods'
  ) return 'Electrical Items';
  if (t === 'stationery' || t === 'stationary') return 'Stationery';
  return 'Others';
};

// ──── Document numbering: RAPS/<KIND>/<FY>/<N> ────
// Counter resets every Indian financial year (Apr 1 – Mar 31), per kind.
// Plain number (no zero-padding). Old records keep their legacy format.
// On unique-constraint collision we retry — handles concurrent inserts.
const DOC_NUMBER_MAP = {
  PR:  { model: 'purchaseRequest',          field: 'requestNumber' },
  // PO is listed for the shared max+1 lookup only — a PO number is never issued
  // automatically. Purchase type it in; see nextPoCountForFy below.
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

// ──── PO number parsing ────
// Splits "RAPS/PO/26-27/101" into { prefix: 'RAPS/PO/26-27/', fy: '26-27', count: 101 }.
// Returns null for anything that isn't in that exact shape (legacy numbers), so
// callers can refuse to renumber what they can't safely rebuild.
const PO_NUMBER_RE = /^RAPS\/PO\/(\d{2}-\d{2})\/(\d+)$/;

const parsePoNumber = (value) => {
  const m = PO_NUMBER_RE.exec(String(value || '').trim());
  if (!m) return null;
  return { prefix: `RAPS/PO/${m[1]}/`, fy: m[1], count: parseInt(m[2], 10) };
};

// Rebuilds a PO number from its FY and a running count. Plain number, no
// zero-padding — the same shape every other document number uses.
const buildPoNumber = (fy, count) => `RAPS/PO/${fy}/${count}`;

// What an order with no number yet reads as, everywhere it is printed or
// exported. Purchase asked for the placeholder they use in their own register
// rather than a sentence. Mirror of PO_NUMBER_PENDING_LABEL in
// client/src/utils/roles.js — keep both in sync.
const PO_NUMBER_PENDING_LABEL = '000';
const poNumberLabel = (order) => order?.orderNumber || PO_NUMBER_PENDING_LABEL;

// A financial-year label is two consecutive 2-digit years, e.g. "26-27".
// "26-28" and "26-25" are rejected — a typo there would silently start a whole
// parallel numbering series that nobody notices until the register is audited.
const isValidFinancialYear = (fy) => {
  const m = /^(\d{2})-(\d{2})$/.exec(String(fy || '').trim());
  if (!m) return false;
  return (parseInt(m[1], 10) + 1) % 100 === parseInt(m[2], 10);
};

// The next free running count for a hand-entered PO number in `fy`. Purchase are
// free to type anything, so this is only ever a SUGGESTION shown in the form —
// the real guard is the unique index on orderNumber. Same max+1 rule the old
// auto-numbering used (including the live-cutover start), but the year comes from
// the caller: Purchase may still be numbering into a closed financial year.
const nextPoCountForFy = async (prisma, fy) => {
  const prefix = `RAPS/PO/${fy}/`;
  const start = DOC_NUMBER_START[fy]?.PO;
  return nextFyCount(prisma, 'purchaseOrder', 'orderNumber', prefix, start ? start - 1 : 0);
};

// MIR uses the same FY-scoped scheme but lives on PurchaseOrder.mirNo.
const generateMirNumber = async (prisma, date = new Date()) => {
  const prefix = `RAPS/MIR/${getFinancialYear(date)}/`;
  const next = await nextFyCount(prisma, 'purchaseOrder', 'mirNo', prefix, baselineFor('MIR', date));
  return `${prefix}${next}`;
};

// Gate pass number counted PER UNIT within the FY: RAPS/GP/<UNIT>/<FY>/<N>.
// `unitCode` is the raising/owning unit's code (falls back to 'GEN' when the
// creator has no unit). The unit segment keeps each unit's counter independent
// and never collides with the old unit-less RAPS/GP/<FY>/<N> numbers.
const gpUnitSegment = (unitCode) =>
  ((unitCode || 'GEN').toString().trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'GEN');

const generateGatePassNumber = async (prisma, unitCode, date = new Date()) => {
  const prefix = `RAPS/GP/${gpUnitSegment(unitCode)}/${getFinancialYear(date)}/`;
  const next = await nextFyCount(prisma, 'gatePass', 'passNumber', prefix, 0);
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
  // Inward QC is part of the QC department — its material reserves to the same
  // "QC" bucket rather than a separate one.
  INWARD_QC: 'QC',
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
// De-duped: several roles can share one department (QC and INWARD_QC both own "QC").
const OWNER_DEPTS = [...new Set(Object.values(DEPT_BY_ROLE))];

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
// or { ok: false, error } so the caller can respond with 400. A requester may
// link ANY live work order regardless of the unit it is assigned to — the forms
// list every order and show its assigned unit — so we only reject
// missing/cancelled/rejected WOs. `requesterUnitId` is retained in the signature
// for callers but is no longer used to gate the link.
const validateWorkOrderLink = async (prisma, rawWorkOrderId, requesterUnitId) => { // eslint-disable-line no-unused-vars
  const workOrderId = rawWorkOrderId || null;
  if (!workOrderId) return { ok: true, workOrderId: null };
  const wo = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    select: { id: true, status: true },
  });
  if (!wo || ['CANCELLED', 'REJECTED'].includes(wo.status)) {
    return { ok: false, error: 'Selected work order is not valid' };
  }
  return { ok: true, workOrderId: wo.id };
};

// ──── PURCHASE-REQUEST REQUIRED-BY FLOOR ────
// Every PR line must be needed at least this many days out, so procurement has a
// workable lead time. Applies on create, on full edit, and on the any-stage
// date change (PUT /purchase-requests/:id/required-by). Mirrored client-side by
// MIN_REQUIRED_BY_DAYS in client/src/pages/PurchaseRequests.jsx — keep in sync.
const MIN_REQUIRED_BY_DAYS = 15;

// This field is a calendar date, not an instant. The existing rows were written
// as `new Date('YYYY-MM-DD')` — i.e. UTC midnight — and every reader formats them
// back with toISOString(), so we keep that storage convention exactly. Comparing
// and storing go through 'YYYY-MM-DD' strings, which sidesteps the off-by-one a
// local-midnight Date would introduce for anyone not on UTC.

// 'YYYY-MM-DD' for a date-only input: a string (already in that shape or ISO) or
// a Date previously stored as UTC midnight. Returns null if unparseable.
const toDateKey = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

// A 'YYYY-MM-DD' key back to the UTC-midnight Date the column stores.
const dateKeyToUtcDate = (key) => new Date(`${key}T00:00:00.000Z`);

const formatDateOnly = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Earliest required-by date a PR line may carry, as 'YYYY-MM-DD'. Built from the
// server's local calendar day + MIN_REQUIRED_BY_DAYS, matching what the browser
// puts in the date picker's `min`.
const requiredByFloorKey = () => {
  const now = new Date();
  return formatDateOnly(new Date(now.getFullYear(), now.getMonth(), now.getDate() + MIN_REQUIRED_BY_DAYS));
};

// Validate one required-by date. An empty value is allowed — the field is
// optional — but anything inside the 15-day window is rejected.
// Returns { ok: true, date } (date may be null) or { ok: false, error }.
const validateRequiredByDate = (value, label = 'Required by date') => {
  if (value === undefined || value === null || value === '') return { ok: true, date: null };
  const key = toDateKey(value);
  if (!key) return { ok: false, error: `${label} is not a valid date` };
  const floor = requiredByFloorKey();
  // Both sides are zero-padded 'YYYY-MM-DD', so lexical order is date order.
  if (key < floor) {
    return {
      ok: false,
      error: `${label} must be at least ${MIN_REQUIRED_BY_DAYS} days from today — pick ${floor} or later`,
    };
  }
  return { ok: true, date: dateKeyToUtcDate(key) };
};

// Validate the required-by date on every line of a PR payload at once. Returns
// { ok: true } or { ok: false, error } naming the offending line.
const validateRequiredByDates = (items) => {
  for (let i = 0; i < (items || []).length; i++) {
    const check = validateRequiredByDate(
      items[i].requiredByDate,
      `Required by date for "${items[i].productName || `item ${i + 1}`}"`,
    );
    if (!check.ok) return check;
  }
  return { ok: true };
};

// ── Tax (GST) on payment requests ──────────────────────────────────────────
// Rates offered in the picker. Anything else can still be typed in as a custom
// percentage, so this is a convenience list, not a whitelist.
const GST_RATES = [0, 5, 12, 18, 28];

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Splits a taxable (basic) amount into { taxPercent, taxAmount, payableAmount }.
// `amount` stays the taxable value everywhere — only payableAmount carries tax.
const computeTax = (amount, taxPercent = 0) => {
  const base = Number(amount) || 0;
  const pct = Number(taxPercent) || 0;
  const taxAmount = round2((base * pct) / 100);
  return { taxPercent: pct, taxAmount, payableAmount: round2(base + taxAmount) };
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
  generateGatePassNumber,
  generateSequentialNumber,
  generateProductSku,
  parsePoNumber,
  buildPoNumber,
  PO_NUMBER_PENDING_LABEL,
  poNumberLabel,
  isValidFinancialYear,
  nextPoCountForFy,
  isUniqueViolation,
  withDocRetry,
  GST_RATES,
  round2,
  computeTax,
  DEPT_BY_ROLE,
  OWNER_DEPTS,
  deptForRole,
  AUTO_ACCEPT_UNIT_NAMES,
  isAutoAcceptUnit,
  validateWorkOrderLink,
  MIN_REQUIRED_BY_DAYS,
  toDateKey,
  formatDateOnly,
  requiredByFloorKey,
  validateRequiredByDate,
  validateRequiredByDates,
};
