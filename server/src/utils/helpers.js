const generateOrderNumber = (prefix) => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
};

const paginate = (page = 1, limit = 20) => {
  const p = Math.max(1, parseInt(page));
  const l = Math.min(1000, Math.max(1, parseInt(limit)));
  return { skip: (p - 1) * l, take: l, page: p, limit: l };
};

const applyDateFilter = (where, { fromDate, toDate }, field = 'createdAt') => {
  if (fromDate || toDate) {
    where[field] = {};
    if (fromDate) where[field].gte = new Date(fromDate);
    if (toDate) {
      const end = new Date(toDate);
      end.setHours(23, 59, 59, 999);
      where[field].lte = end;
    }
  }
};

// Generates a daily-reset MIR number MIR-YYYYMMDD-NNN.
// Counter resets each day by counting existing MIRs assigned for today's date.
// Pass a Prisma client to query the live counter.
const generateMirNumber = async (prisma) => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const datePart = `${y}${m}${d}`;
  const prefix = `MIR-${datePart}-`;

  // Find the highest existing counter for today's prefix across PurchaseOrder.mirNo
  const todays = await prisma.purchaseOrder.findMany({
    where: { mirNo: { startsWith: prefix } },
    select: { mirNo: true },
  });
  let max = 0;
  for (const { mirNo } of todays) {
    const n = parseInt(mirNo.slice(prefix.length), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  const next = String(max + 1).padStart(3, '0');
  return `${prefix}${next}`;
};

module.exports = { generateOrderNumber, paginate, applyDateFilter, generateMirNumber };
