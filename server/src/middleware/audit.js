const prisma = require('../config/db');

const pickDetails = (req, data) => {
  const d = { method: req.method, path: req.path };
  const body = req.body || {};
  if (body.status) d.status = body.status;
  if (body.quantity) d.quantity = body.quantity;
  if (body.amount) d.amount = body.amount;
  if (body.notes) d.reason = String(body.notes).slice(0, 100);
  if (data?.orderNumber) d.orderNumber = data.orderNumber;
  if (data?.requestNumber) d.requestNumber = data.requestNumber;
  if (data?.gatePassNumber) d.gatePassNumber = data.gatePassNumber;
  if (data?.paymentNumber) d.paymentNumber = data.paymentNumber;
  if (body.productName) d.productName = String(body.productName).slice(0, 60);
  return d;
};

const auditLog = (action, entity) => {
  return async (req, res, next) => {
    const originalJson = res.json.bind(res);

    res.json = (data) => {
      if (res.statusCode >= 200 && res.statusCode < 300 && req.user) {
        // SUPERADMIN actions are NEVER logged — their work is invisible to other admins.
        if (req.user.role === 'SUPERADMIN') return originalJson(data);

        prisma.auditLog.create({
          data: {
            userId: req.user.id,
            action,
            entity,
            entityId: data?.id || req.params?.id || null,
            details: pickDetails(req, data),
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
