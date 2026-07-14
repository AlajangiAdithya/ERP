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
// (ID No., name, material type, specification, shelf life, storage temp — never
// stock numbers) directly from the Stock Details list while they learn the system.
// Auto-expires on this date; afterwards Stores are read-only again and only the
// master owners can edit. Mirror of STORE_PRODUCT_EDIT_UNTIL in
// server/src/middleware/rbac.js — keep both in sync.
export const STORE_PRODUCT_EDIT_UNTIL = new Date('2026-09-20T23:59:59');

export function storeProductEditWindowOpen(now = new Date()) {
  return now.getTime() <= STORE_PRODUCT_EDIT_UNTIL.getTime();
}

// Who may edit a product's descriptive details from the Stock Details list.
// Master owners always; Stores only while the temporary rollout window is open.
export function canEditProductDetails(user) {
  if (!user) return false;
  if (isProductMasterEditor(user)) return true;
  return user.role === 'STORE_MANAGER' && storeProductEditWindowOpen();
}
