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

module.exports = prisma;
