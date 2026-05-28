// Approval tiers for purchase decisions (quotation selection + payment release).
//
// Threshold rules (in INR):
//   L1: amount < 5,00,000   → any ADMIN or ACCOUNTING user
//   L2: amount >= 5,00,000  → any ADMIN (no upper cap)

const prisma = require('../config/db');

const FIVE_LAKHS = 500000;

const APPROVER_DISPLAY = {
  L1: 'Any admin or accounting user',
  L2: 'Any admin',
};

function getTier(amount) {
  if (amount < FIVE_LAKHS) return 'L1';
  return 'L2';
}

function getTierLabel(tier) {
  return APPROVER_DISPLAY[tier] || 'Unknown';
}

// Returns true if the given user (with role) can approve the given amount.
function canApprove(user, amount) {
  if (!user) return false;
  const tier = getTier(amount);
  const role = user.role;

  if (tier === 'L1') {
    return role === 'ADMIN' || role === 'ACCOUNTING';
  }

  // L2: any admin
  return role === 'ADMIN';
}

// Look up the user records eligible to approve at a given tier. Used to
// populate notification targets and display "who to ping".
async function getApproversForTier(tier) {
  if (tier === 'L1') {
    return prisma.user.findMany({
      where: {
        isActive: true,
        role: { in: ['ADMIN', 'ACCOUNTING'] },
      },
      select: { id: true, name: true, username: true, role: true },
    });
  }

  return prisma.user.findMany({
    where: { role: 'ADMIN', isActive: true },
    select: { id: true, name: true, username: true, role: true },
  });
}

module.exports = {
  FIVE_LAKHS,
  getTier,
  getTierLabel,
  canApprove,
  getApproversForTier,
};
