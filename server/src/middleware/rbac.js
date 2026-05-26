const ROLE_HIERARCHY = {
  ADMIN: 4,
  STORE_MANAGER: 3,
  ACCOUNTING: 3,
  FINANCE: 3,
  SUPPLY_CHAIN: 3,
  SAFETY: 3,
  LOGISTICS: 3,
  PLANNING: 2,
  QC: 2,
  MANAGER: 2,
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

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
};

const authorizeMinRole = (minRole) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (ROLE_HIERARCHY[req.user.role] < ROLE_HIERARCHY[minRole]) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
};

module.exports = { authorize, authorizeMinRole };
