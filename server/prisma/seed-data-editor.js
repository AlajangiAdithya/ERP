// Idempotent seed for the hidden, edit-only DATA_EDITOR account.
// This login never appears in any UI list — it is reachable only by logging in
// directly with these credentials. Run: node prisma/seed-data-editor.js
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

const USERNAME = 'editing';
const PASSWORD = 'Editing@123';
const NAME = 'Editor';

(async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const existing = await prisma.user.findUnique({ where: { username: USERNAME } });

  if (existing) {
    // Reset hash + ensure role = DATA_EDITOR (in case it was changed)
    await prisma.user.update({
      where: { username: USERNAME },
      data: { passwordHash, plainPassword: PASSWORD, role: 'DATA_EDITOR', isActive: true, name: NAME },
    });
    console.log(`Updated existing data-editor user (id=${existing.id})`);
  } else {
    const created = await prisma.user.create({
      data: {
        username: USERNAME,
        passwordHash,
        plainPassword: PASSWORD,
        name: NAME,
        role: 'DATA_EDITOR',
        isActive: true,
      },
    });
    console.log(`Created data-editor user (id=${created.id})`);
  }

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
