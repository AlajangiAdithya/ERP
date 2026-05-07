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

module.exports = { generateOrderNumber, paginate, applyDateFilter };
