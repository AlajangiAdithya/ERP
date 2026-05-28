// Guard that allows ONLY the SUPERADMIN role through.
// Used on /api/superadmin/* endpoints.
const superadminOnly = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (req.user.role !== 'SUPERADMIN') {
    // Deliberately use the same 404 message as a missing route, so the existence
    // of these endpoints isn't discoverable by a regular admin probing the API.
    return res.status(404).json({ error: 'Not found' });
  }
  next();
};

module.exports = { superadminOnly };
