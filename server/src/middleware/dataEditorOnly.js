// Guard for the edit-only table editor (/api/data-editor/*).
// Allows the dedicated DATA_EDITOR role and SUPERADMIN (who can do everything).
const dataEditorOnly = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (req.user.role !== 'DATA_EDITOR' && req.user.role !== 'SUPERADMIN') {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
};

module.exports = { dataEditorOnly };
