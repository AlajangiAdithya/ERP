const { PrismaClient } = require('@prisma/client');

const url = new URL(process.env.DATABASE_URL);
if (!url.searchParams.has('connection_limit')) {
  url.searchParams.set('connection_limit', '8');
}

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  datasources: {
    db: { url: url.toString() },
  },
});

// Every Notification row created anywhere in the codebase also goes out as a
// web push (phone/desktop OS notification). Hooked here so the ~50 scattered
// prisma.notification.create / createMany call sites don't need changes.
prisma.$use(async (params, next) => {
  const result = await next(params);
  if (params.model === 'Notification' && (params.action === 'create' || params.action === 'createMany')) {
    const { sendForNotifications } = require('../services/push');
    // create returns the row (with id); createMany only returns a count, so
    // fall back to the input data — push payloads don't strictly need the id.
    const rows = params.action === 'create' ? result : params.args?.data;
    if (rows) sendForNotifications(prisma, rows);
  }
  return result;
});

module.exports = prisma;
