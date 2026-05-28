// Idempotent seed for the hidden owner-only SUPERADMIN account.
// Run: node prisma/seed-superadmin.js
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const USERNAME = 'superadmin';
const PASSWORD = 'Alajangi@06';
const NAME = 'Super Admin';

(async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const existing = await prisma.user.findUnique({ where: { username: USERNAME } });

  if (existing) {
    // Reset hash + ensure role = SUPERADMIN (in case it was changed)
    await prisma.user.update({
      where: { username: USERNAME },
      data: { passwordHash, plainPassword: PASSWORD, role: 'SUPERADMIN', isActive: true, name: NAME },
    });
    console.log(`Updated existing superadmin user (id=${existing.id})`);
  } else {
    const created = await prisma.user.create({
      data: {
        username: USERNAME,
        passwordHash,
        plainPassword: PASSWORD,
        name: NAME,
        role: 'SUPERADMIN',
        isActive: true,
      },
    });
    console.log(`Created superadmin user (id=${created.id})`);
  }

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
