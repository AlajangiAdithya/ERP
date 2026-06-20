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

// Is this user a product master-data owner (Unit 1–5 manager, plus ADMIN/
// SUPERADMIN override)? Reused by the guard and the edit route to decide whether
// saving a product also finalises its master-data gate.
const isProductMasterRole = (user) => {
  if (!user) return false;
  const { role } = user;
  if (role === 'SUPERADMIN' || role === 'ADMIN') return true;
  return role === 'MANAGER' && PRODUCT_MASTER_UNIT_CODES.includes(user.unit?.code);
};

const authorizeProductMaster = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (isProductMasterRole(req.user)) return next();
  return res.status(403).json({ error: 'Insufficient permissions' });
};

// TEMPORARY (new-system rollout): the Stores team may edit a product's *details*
// (ID No., name, material type, specification, shelf life, storage temp — never
// stock numbers) directly from the Stock Details list while they learn the system.
// Auto-expires on this date so the access doesn't linger; after it, STORE_MANAGER
// is read-only again and only the master owners can edit. The client mirror is
// STORE_PRODUCT_EDIT_UNTIL in client/src/utils/roles.js — keep both in sync.
const STORE_PRODUCT_EDIT_UNTIL = new Date('2026-09-20T23:59:59');
const storeProductEditWindowOpen = () => Date.now() <= STORE_PRODUCT_EDIT_UNTIL.getTime();

// Guards PUT /products/:id only. Master owners always; Stores during the window.
// (Create / delete / spec / MSDS stay master-only via authorizeProductMaster.)
const authorizeProductEdit = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (isProductMasterRole(req.user)) return next();
  if (req.user.role === 'STORE_MANAGER' && storeProductEditWindowOpen()) return next();
  return res.status(403).json({ error: 'Insufficient permissions' });
};

module.exports = {
  authorize,
  authorizeMinRole,
  authorizeProductMaster,
  authorizeProductEdit,
  isProductMasterRole,
  STORE_PRODUCT_EDIT_UNTIL,
};
