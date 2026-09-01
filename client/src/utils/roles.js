// Product master-data editors. Master data (product specs + shelf life) is owned
// exclusively by the Unit 1–5 managers. A MANAGER of any other unit (e.g. Unit
// 1A) is read-only; QC/Stores/Purchase only consume product names. ADMIN/
// SUPERADMIN keep an override for support. Mirrors the server guard
// `isProductMasterRole` / `authorizeProductMaster` in server/src/middleware/rbac.js.
const PRODUCT_MASTER_UNIT_CODES = ['1', '2', '3', '4', '5'];

// The Unit 1–5 managers are the main managers here and log in with these
// usernames. They own master data regardless of how their unit link is set up,
// so match on username too. Normalised so "Unit 1", "unit1" and "unit 1" all
// resolve to the same key. Mirrors PRODUCT_MASTER_USERNAMES in server rbac.js.
const PRODUCT_MASTER_USERNAMES = ['unit1', 'unit2', 'unit3', 'unit4', 'unit5'];
const normalizeUsername = (u) => (u || '').toLowerCase().replace(/\s+/g, '');

export function isProductMasterEditor(user) {
  if (!user) return false;
  const { role } = user;
  if (role === 'SUPERADMIN' || role === 'ADMIN') return true;
  if (PRODUCT_MASTER_USERNAMES.includes(normalizeUsername(user.username))) return true;
  return role === 'MANAGER' && PRODUCT_MASTER_UNIT_CODES.includes(user.unit?.code);
}

// TEMPORARY (new-system rollout): the Stores team may edit a product's *details*
// (material code, name, material type, specification, shelf life, storage temp — never
// stock numbers) directly from the Stock Details list while they learn the system.
// Auto-expires on this date; afterwards Stores are read-only again and only the
// master owners can edit. Mirror of STORE_PRODUCT_EDIT_UNTIL in
// server/src/middleware/rbac.js — keep both in sync.
export const STORE_PRODUCT_EDIT_UNTIL = new Date('2026-09-20T23:59:59');

export function storeProductEditWindowOpen(now = new Date()) {
  return now.getTime() <= STORE_PRODUCT_EDIT_UNTIL.getTime();
}

// ──── Master data: who may ADD, who may EDIT ────
// Master data is owned by Admin, Quality and the unit managers — nobody else may
// put a material into the catalogue. Any other requester who needs a new material
// asks one of them to add it first. Product.createdBy records who did it.
// Mirror of PRODUCT_CREATE_ROLES in server/src/middleware/rbac.js.
const PRODUCT_CREATE_ROLES = ['ADMIN', 'MANAGER', 'QC'];

export function canCreateProduct(user) {
  if (!user) return false;
  return user.role === 'SUPERADMIN' || PRODUCT_CREATE_ROLES.includes(user.role);
}

// Editing master data stays narrow: the Unit 1–5 managers own it, plus the
// person who entered that particular material. Everyone else is read-only.
// `product` must be the loaded record (it carries createdById).
export function canEditProductMasterData(user, product) {
  if (!user) return false;
  if (isProductMasterEditor(user)) return true;
  return !!product?.createdById && product.createdById === user.id;
}

// Who may edit a product's descriptive details from the Stock Details list.
// Master owners and the material's author always; Stores only while the
// temporary rollout window is open.
export function canEditProductDetails(user, product) {
  if (!user) return false;
  if (canEditProductMasterData(user, product)) return true;
  return user.role === 'STORE_MANAGER' && storeProductEditWindowOpen();
}

// Could this user edit at least SOME products? Decides whether an Edit column or
// button is drawn at all — each row still runs the per-product check above.
export function canEditAnyProductDetails(user) {
  return canEditProductDetails(user, null) || canCreateProduct(user);
}

// ──── PO numbering (permanent) ────
// PO numbers are typed in by Purchase, not generated. An approved quotation
// creates its orders with no number; they sit on the PO page as drafts until
// Purchase fill RAPS/PO/<FY>/<n> in, and only then can be placed. Mirror of
// PO_NUMBER_ASSIGN_ROLES in server/src/middleware/rbac.js — the server is the
// real gate, this only decides whether the form is drawn.
const PO_NUMBER_ASSIGN_ROLES = ['PURCHASE_OFFICER', 'ADMIN', 'SUPERADMIN'];

export function canAssignPoNumber(user) {
  if (!user) return false;
  return PO_NUMBER_ASSIGN_ROLES.includes(user.role);
}

// What every screen shows in place of the number while an order is still a
// draft. Purchase asked for a literal placeholder rather than a phrase, so an
// un-numbered order reads as "000" everywhere it appears — the same way it sits
// in their paper register until the real number is written against it.
export const PO_NUMBER_PENDING_LABEL = '000';

// The call to action shown next to that placeholder for whoever may fill it in.
export const PO_NUMBER_FILL_LABEL = 'Update PO number';

// Number as it should be displayed anywhere a PO is referenced.
export const poNumberLabel = (order) => order?.orderNumber || PO_NUMBER_PENDING_LABEL;

// Indian financial year label for a date: Apr 1 starts a new year.
// e.g. 25 Aug 2026 → "26-27". Mirror of getFinancialYear in
// server/src/utils/helpers.js — used to pre-fill the FY on the numbering form.
export function currentFinancialYear(date = new Date()) {
  const y = date.getFullYear();
  const startYear = date.getMonth() >= 3 ? y : y - 1; // 0-indexed: 3 = April
  return `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
}

// ════════════════════════════════════════════════════════════════════════════
// TEMPORARY FEATURE — PO RE-NUMBERING. REMOVE WHEN THE ROLLOUT IS OVER.
// ════════════════════════════════════════════════════════════════════════════
// While Purchase reconcile the old manual PO register against the system, they
// may correct the running count on a PO number (RAPS/PO/<FY>/<n> — only <n>
// changes). Mirror of PO_NUMBER_EDIT_UNTIL / PO_NUMBER_EDIT_ROLES in
// server/src/middleware/rbac.js — keep both in sync; the server is the real
// gate, this only decides whether the pencil button is drawn.
//
// null = no expiry set yet (the date will be fixed later). Set a Date here (and
// on the server) to retire it, or delete this block plus the RenumberPoModal in
// client/src/pages/PurchaseOrders.jsx to remove it outright.
export const PO_NUMBER_EDIT_UNTIL = null;
const PO_NUMBER_EDIT_ROLES = ['PURCHASE_OFFICER', 'ADMIN', 'SUPERADMIN'];

export function poNumberEditWindowOpen(now = new Date()) {
  return !PO_NUMBER_EDIT_UNTIL || now.getTime() <= PO_NUMBER_EDIT_UNTIL.getTime();
}

export function canEditPoNumber(user) {
  if (!user) return false;
  return PO_NUMBER_EDIT_ROLES.includes(user.role) && poNumberEditWindowOpen();
}

// "RAPS/PO/26-27/101" → { prefix: 'RAPS/PO/26-27/', fy: '26-27', count: 101 }.
// null for legacy / hand-entered numbers, which can't be renumbered. Mirror of
// parsePoNumber in server/src/utils/helpers.js.
export function parsePoNumber(value) {
  const m = /^RAPS\/PO\/(\d{2}-\d{2})\/(\d+)$/.exec(String(value || '').trim());
  if (!m) return null;
  return { prefix: `RAPS/PO/${m[1]}/`, fy: m[1], count: parseInt(m[2], 10) };
}
// ════════════════ END TEMPORARY FEATURE — PO RE-NUMBERING ═══════════════════
