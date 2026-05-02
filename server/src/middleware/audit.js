const prisma = require('../config/db');

const auditLog = (action, entity) => {
  return async (req, res, next) => {
    const originalJson = res.json.bind(res);

    res.json = (data) => {
      if (res.statusCode >= 200 && res.statusCode < 300 && req.user) {
        prisma.auditLog.create({
          data: {
            userId: req.user.id,
            action,
            entity,
            entityId: data?.id || req.params?.id || null,
            details: { method: req.method, path: req.path },
            ipAddress: req.ip || req.connection?.remoteAddress,
          },
        }).catch((err) => console.error('Audit log error:', err));
      }
      return originalJson(data);
    };

    next();
  };
};

module.exports = { auditLog };
