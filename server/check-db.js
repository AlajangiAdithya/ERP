const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const res = await prisma.$queryRaw`SELECT typname FROM pg_type WHERE typname IN ('Role', 'Role_old', 'IONStatus')`;
  console.log(res);
  const tables = await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE tablename IN ('InterOfficeNote', 'IONItem', 'QuotationItem')`;
  console.log(tables);
}
main().finally(() => prisma.$disconnect());
