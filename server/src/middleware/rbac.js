const ROLE_HIERARCHY = {
  // SUPERADMIN sits above ADMIN and bypasses every authorize() check below.
  SUPERADMIN: 99,
  ADMIN: 4,
  STORE_MANAGER: 3,
  ACCOUNTING: 3,
  FINANCE: 3,
  SUPPLY_CHAIN: 3,
  SAFETY: 3,
  LOGISTICS: 3,
  HR: 3,
  PLANNING: 2,
  QC: 2,
  MANAGER: 2,
  // Inward-only QC operator — sits at the QC tier for the one action it performs
  // (inward-material review). Its narrow scope is enforced by the route allow-lists,
  // not the hierarchy. See materialInward.routes.js.
  INWARD_QC: 2,
  DESIGNS: 2,
  PURCHASE_OFFICER: 1,
  // Edit-only data corrector. Sits at the bottom of the hierarchy — its access
  // is the /api/data-editor route allow-list, not any authorize() check.
  DATA_EDITOR: 1,
  LAB: 1,
  METROLOGY: 1,
  NDT: 1,
  RND: 1,
};

const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // SUPERADMIN bypasses every role check — they can hit any endpoint.
    if (req.user.role === 'SUPERADMIN') return next();

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
};

const authorizeMinRole = (minRole) => {
  if (ROLE_HIERARCHY[minRole] === undefined) {
    throw new Error(`authorizeMinRole: unknown role "${minRole}"`);
  }
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (req.user.role === 'SUPERADMIN') return next();

    const userLevel = ROLE_HIERARCHY[req.user.role];
    if (userLevel === undefined || userLevel < ROLE_HIERARCHY[minRole]) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
};

// Product master-data editors. Master data (product specs + shelf life) is owned
// exclusively by the Unit 1–5 managers. A MANAGER of any other unit (e.g. Unit
// 1A) is read-only, and QC/Stores/Purchase only consume product names — they
// don't edit master data. ADMIN/SUPERADMIN keep an override for support. Unit
// codes are seeded as '1','1A','2','3','4','5' (prisma/seed.js); req.user.unit.code
// is loaded by the auth middleware.
const PRODUCT_MASTER_UNIT_CODES = ['1', '2', '3', '4', '5'];

// The Unit 1–5 managers are the main managers here and log in with these
// usernames. They own master data regardless of how their unit link is set up,
// so match on username too (not just unit.code above). Normalised so "Unit 1",
// "unit1" and "unit 1" all resolve to the same key.
const PRODUCT_MASTER_USERNAMES = ['unit1', 'unit2', 'unit3', 'unit4', 'unit5'];
const normalizeUsername = (u) => (u || '').toLowerCase().replace(/\s+/g, '');

// Is this user a product master-data owner (Unit 1–5 manager, plus ADMIN/
// SUPERADMIN override)? Reused by the guard and the edit route to decide whether
// saving a product also finalises its master-data gate.
const isProductMasterRole = (user) => {
  if (!user) return false;
  const { role } = user;
  if (role === 'SUPERADMIN' || role === 'ADMIN') return true;
  if (PRODUCT_MASTER_USERNAMES.includes(normalizeUsername(user.username))) return true;
  return role === 'MANAGER' && PRODUCT_MASTER_UNIT_CODES.includes(user.unit?.code);
};

const authorizeProductMaster = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (isProductMasterRole(req.user)) return next();
  return res.status(403).json({ error: 'Insufficient permissions' });
};

// ──── Master data: who may ADD, who may EDIT ────
// A purchase-request line can only name a material that is already in Master
// Data (no more free-text "new material" rows), so everyone who raises PRs has
// to be able to put one there — otherwise a Lab/Designs/Safety request is
// blocked until somebody else acts. Adding is therefore open to every requester
// role; Product.createdById records who did it.
//
// EDITING stays narrow: the Unit 1–5 managers own master data, plus the person
// who entered that particular material (they are the one who knows what they
// meant). Everyone else is read-only. Mirror of PRODUCT_CREATE_ROLES /
// canEditProductMasterData in client/src/utils/roles.js — the server is the real
// gate, the client mirror only decides what is drawn.
//
// Mirrors REQUESTER_ROLES in server/src/routes/purchaseRequest.routes.js (the
// list of roles that may raise a PR), plus the master owners.
const PRODUCT_CREATE_ROLES = [
  'ADMIN', 'MANAGER', 'DESIGNS', 'RND', 'QC', 'INWARD_QC', 'STORE_MANAGER',
  'LAB', 'METROLOGY', 'NDT', 'SAFETY', 'PLANNING',
];

const canCreateProduct = (user) =>
  !!user && (user.role === 'SUPERADMIN' || PRODUCT_CREATE_ROLES.includes(user.role));

// Guards POST /products and POST /products/bulk.
const authorizeProductCreate = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (canCreateProduct(req.user)) return next();
  return res.status(403).json({ error: 'Your role cannot add materials to master data' });
};

// Per-product edit gate. Needs the product loaded (for createdById), so routes
// call this after fetching rather than mounting it as middleware.
const canEditProductMasterData = (user, product) => {
  if (!user) return false;
  if (isProductMasterRole(user)) return true;
  return !!product?.createdById && product.createdById === user.id;
};

// TEMPORARY (new-system rollout): the Stores team may edit a product's *details*
// (ID No., name, material type, specification, shelf life, storage temp — never
// stock numbers) directly from the Stock Details list while they learn the system.
// Auto-expires on this date so the access doesn't linger; after it, STORE_MANAGER
// is read-only again and only the master owners can edit. The client mirror is
// STORE_PRODUCT_EDIT_UNTIL in client/src/utils/roles.js — keep both in sync.
const STORE_PRODUCT_EDIT_UNTIL = new Date('2026-09-20T23:59:59');
const storeProductEditWindowOpen = () => Date.now() <= STORE_PRODUCT_EDIT_UNTIL.getTime();

// Who may edit a product's details (PUT /products/:id, spec + MSDS files):
//   • master owners (Unit 1–5 managers, Admin/Superadmin) — any product
//   • whoever entered the product in master data          — their own entry
//   • STORE_MANAGER                                       — rollout window only
// Needs the product loaded (for createdById), so routes call this after fetching
// rather than mounting it as middleware.
const canEditProductDetails = (user, product) => {
  if (!user) return false;
  if (canEditProductMasterData(user, product)) return true;
  return user.role === 'STORE_MANAGER' && storeProductEditWindowOpen();
};

// 403 body shared by every per-product edit gate, so the reason is always the
// same sentence whichever route refused.
const PRODUCT_EDIT_FORBIDDEN =
  'Only the Unit 1–5 managers or the person who added this material to master data can change it';

// ──── PO numbering (permanent) ────
// PO numbers are not generated by the system. When a quotation is approved the
// order is created WITHOUT a number and sits on the PO page as a draft; Purchase
// then type RAPS/PO/<FY>/<n> in themselves and only then can the order be placed.
// Same roles as the re-numbering gate below, but this one never expires.
const PO_NUMBER_ASSIGN_ROLES = ['PURCHASE_OFFICER', 'ADMIN', 'SUPERADMIN'];

const canAssignPoNumber = (user) => !!user && PO_NUMBER_ASSIGN_ROLES.includes(user.role);

// Guards PATCH /purchase-orders/:id/assign-number only.
const authorizePoNumberAssign = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (!canAssignPoNumber(req.user)) {
    return res.status(403).json({ error: 'Only the Purchase team can fill in a PO number' });
  }
  return next();
};

// ════════════════════════════════════════════════════════════════════════════
// TEMPORARY FEATURE — PO RE-NUMBERING. REMOVE WHEN THE ROLLOUT IS OVER.
// ════════════════════════════════════════════════════════════════════════════
// The Purchase team is still reconciling the old manual PO register against the
// system, so they may correct the running count on a PO number
// (RAPS/PO/<FY>/<n> — only <n> changes; the prefix and financial year are fixed).
// Changing it rewrites every downstream copy of the number: derived batch
// numbers, stock/batch notes, MIV lines, inward-register rows and notification
// text. Audit logs are deliberately left untouched.
//
// This is NOT a permanent capability. To switch it off, set PO_NUMBER_EDIT_UNTIL
// to a date (it then dies on its own, like STORE_PRODUCT_EDIT_UNTIL above).
// To delete it outright, remove: this block, PATCH /purchase-orders/:id/order-number
// in server/src/routes/purchaseOrder.routes.js, and the client mirror
// (canEditPoNumber in client/src/utils/roles.js + the pencil button and
// RenumberPoModal in client/src/pages/PurchaseOrders.jsx). The
// PurchaseOrderNumberHistory table and its "Number history" panel stay — past
// renames must remain traceable after the button is gone.
//
// null = no expiry set yet (the date will be fixed later). The client mirror is
// PO_NUMBER_EDIT_UNTIL in client/src/utils/roles.js — keep both in sync.
const PO_NUMBER_EDIT_UNTIL = null;
const PO_NUMBER_EDIT_ROLES = ['PURCHASE_OFFICER', 'ADMIN', 'SUPERADMIN'];

const poNumberEditWindowOpen = () =>
  !PO_NUMBER_EDIT_UNTIL || Date.now() <= PO_NUMBER_EDIT_UNTIL.getTime();

const canEditPoNumber = (user) =>
  !!user && PO_NUMBER_EDIT_ROLES.includes(user.role) && poNumberEditWindowOpen();

// Guards PATCH /purchase-orders/:id/order-number only.
const authorizePoNumberEdit = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (!poNumberEditWindowOpen()) {
    return res.status(403).json({ error: 'PO re-numbering is no longer available' });
  }
  if (!canEditPoNumber(req.user)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  return next();
};
// ════════════════ END TEMPORARY FEATURE — PO RE-NUMBERING ═══════════════════

module.exports = {
  authorize,
  authorizeMinRole,
  authorizeProductMaster,
  authorizeProductCreate,
  canCreateProduct,
  canEditProductMasterData,
  canEditProductDetails,
  PRODUCT_EDIT_FORBIDDEN,
  isProductMasterRole,
  STORE_PRODUCT_EDIT_UNTIL,
  canAssignPoNumber,
  authorizePoNumberAssign,
  PO_NUMBER_EDIT_UNTIL,
  poNumberEditWindowOpen,
  canEditPoNumber,
  authorizePoNumberEdit,
};
