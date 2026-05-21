// Approval tiers for purchase decisions (quotation selection + payment release).
//
// Threshold rules (in INR):
//   L1: amount < 1,00,000           → ACCOUNTING role OR any tiered admin
//   L2: 1,00,000 <= amount < 10,00,000 → Madhubabu, Sureshbabu, OR Rameshbabu
//   L3: amount >= 10,00,000         → Rameshbabu only
//
// Madhubabu, Sureshbabu, Rameshbabu are existing ADMIN users — matched by name (case-insensitive).

const prisma = require('../config/db');

const ONE_LAKH = 100000;
const TEN_LAKHS = 1000000;

const APPROVER_NAMES = {
  L2: ['madhubabu', 'sureshbabu', 'rameshbabu'],
  L3: ['rameshbabu'],
};

const APPROVER_DISPLAY = {
  L1: 'Accounting (or any approving admin)',
  L2: 'Madhubabu, Sureshbabu, or Rameshbabu',
  L3: 'Rameshbabu',
};

function getTier(amount) {
  if (amount < ONE_LAKH) return 'L1';
  if (amount < TEN_LAKHS) return 'L2';
  return 'L3';
}

function getTierLabel(tier) {
  return APPROVER_DISPLAY[tier] || 'Unknown';
}

// Normalise a name for comparison: lowercase, strip whitespace, drop common prefixes/honorifics.
function normaliseName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// Match against either username or name (after stripping non-alphanumerics).
function matchesAnyApprover(user, approverList) {
  const candidates = [user.username, user.name].filter(Boolean).map(normaliseName);
  return candidates.some(c => approverList.some(a => c.includes(a)));
}

// Returns true if the given user (with role + name + username) can approve the given amount.
function canApprove(user, amount) {
  if (!user) return false;
  const tier = getTier(amount);
  const role = user.role;

  if (tier === 'L1') {
    if (role === 'ACCOUNTING') return true;
    if (role === 'ADMIN' && matchesAnyApprover(user, APPROVER_NAMES.L2)) return true;
    return false;
  }

  if (tier === 'L2') {
    if (role !== 'ADMIN') return false;
    return matchesAnyApprover(user, APPROVER_NAMES.L2);
  }

  // L3
  if (role !== 'ADMIN') return false;
  return matchesAnyApprover(user, APPROVER_NAMES.L3);
}

// Look up the actual user records for the approvers configured for a given tier.
// Used to populate notification targets and display "who to ping".
async function getApproversForTier(tier) {
  const names = tier === 'L1'
    ? APPROVER_NAMES.L2  // L1 also notifies tiered admins (since accounting may escalate)
    : APPROVER_NAMES[tier];

  if (!names || names.length === 0) return [];

  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN', isActive: true },
    select: { id: true, name: true, username: true, role: true },
  });

  return admins.filter(a => matchesAnyApprover(a, names));
}

module.exports = {
  ONE_LAKH,
  TEN_LAKHS,
  getTier,
  getTierLabel,
  canApprove,
  getApproversForTier,
  normaliseName,
};
