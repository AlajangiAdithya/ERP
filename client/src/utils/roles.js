// Product master-data editors. Master data (product specs + shelf life) is owned
// exclusively by the Unit 1–5 managers. A MANAGER of any other unit (e.g. Unit
// 1A) is read-only; QC/Stores/Purchase only consume product names. ADMIN/
// SUPERADMIN keep an override for support. Mirrors the server guard
// `isProductMasterRole` / `authorizeProductMaster` in server/src/middleware/rbac.js.
const PRODUCT_MASTER_UNIT_CODES = ['1', '2', '3', '4', '5'];

export function isProductMasterEditor(user) {
  if (!user) return false;
  const { role } = user;
  if (role === 'SUPERADMIN' || role === 'ADMIN') return true;
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
