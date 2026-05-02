const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function addAdmins() {
  const hash = await bcrypt.hash('Admin@123', 12);

  const admins = [
    { username: 'madhubabu', name: 'Madhubabu' },
    { username: 'suresh', name: 'Suresh' },
    { username: 'rameshbabu', name: 'Rameshbabu' },
  ];

  for (const admin of admins) {
    try {
      const user = await prisma.user.create({
        data: {
          username: admin.username,
          passwordHash: hash,
          name: admin.name,
          role: 'ADMIN',
        },
      });
      console.log(`Created admin: ${admin.name} (${user.id})`);
    } catch (e) {
      if (e.code === 'P2002') {
        console.log(`Admin "${admin.username}" already exists, skipping.`);
      } else {
        throw e;
      }
    }
  }

  console.log('\nAll done! Login credentials:');
  console.log('  madhubabu  / Admin@123');
  console.log('  suresh     / Admin@123');
  console.log('  rameshbabu / Admin@123');

  await prisma.$disconnect();
}

addAdmins().catch((e) => {
  console.error(e);
  process.exit(1);
});
