// Who owns reserved stock, and how much of a product one user can actually draw.
//
// Mirror of server utils/helpers DEPT_BY_ROLE - non-unit roles that own reserved
// stock. Stores is intentionally absent (its stock is the shared pool).
export const DEPT_BY_ROLE = {
  DESIGNS: 'Designs', PLANNING: 'Planning', QC: 'QC', LAB: 'Lab',
  METROLOGY: 'Metrology', NDT: 'NDT', SAFETY: 'Safety',
};

// Roles that can raise an inventory transfer into their own unit / department.
export const canRaiseTransfer = (user) =>
  (user?.role === 'MANAGER' && !!user?.unitId) || !!DEPT_BY_ROLE[user?.role];

// Splits a product's stock the way the server does when it issues a MIV:
//   availableToYou = your own unit/department bucket + the unassigned pool
//   holders        = every OTHER unit/department holding some, which you can
//                    only get through an inventory transfer
// Needs a product loaded with includeUnitStock=true (unitStocks + deptStocks).
// `ownerToken` matches the Inventory Transfers page: `unit:<id>` / `dept:<Label>`.
export function stockViewFor(product, user) {
  const unitStocks = (product?.unitStocks || []).filter((u) => u.quantity > 0);
  const deptStocks = (product?.deptStocks || []).filter((d) => d.quantity > 0);
  const myUnitId = user?.unitId || null;
  const myDept = myUnitId ? null : (DEPT_BY_ROLE[user?.role] || null);

  const assigned = unitStocks.reduce((s, u) => s + u.quantity, 0) + deptStocks.reduce((s, d) => s + d.quantity, 0);
  const own = myUnitId
    ? (unitStocks.find((u) => u.unitId === myUnitId)?.quantity || 0)
    : (deptStocks.find((d) => d.dept === myDept)?.quantity || 0);
  const pool = Math.max(0, (product?.currentStock || 0) - assigned);

  const holders = [
    ...unitStocks.filter((u) => u.unitId !== myUnitId).map((u) => ({
      ownerToken: `unit:${u.unitId}`,
      label: u.unit?.name || u.unit?.code || 'Unit',
      short: u.unit?.code || u.unit?.name || 'Unit',
      quantity: u.quantity,
    })),
    ...deptStocks.filter((d) => myUnitId || d.dept !== myDept).map((d) => ({
      ownerToken: `dept:${d.dept}`,
      label: `${d.dept} department`,
      short: d.dept,
      quantity: d.quantity,
    })),
  ];

  return { availableToYou: own + pool, holders };
}
